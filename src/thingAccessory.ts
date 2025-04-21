// src/thingAccessory.ts
//
// Fully updated “Thing Accessory” implementation for MQTT Thing NG
// - Full serviceMap covering ~30 accessory types
// - Per‐characteristic topic filtering (get/set/parse/apply/jsonPath/qos/retain)
// - Guarded characteristic routing
// - VM2 sandboxed apply/parse with 100 ms timeout
// - FakeGato history logging for supported types
// - Graceful shutdown removing MQTT listeners

import {
  Logger,
  PlatformAccessory,
  CharacteristicValue,
  HAP,
  Service,
  Characteristic,
} from 'homebridge';
import { JSONPath } from 'jsonpath-plus';
import { VM } from 'vm2';
import { MQTTConnection } from './services/mqtt';
import FakeGatoHistoryService from 'fakegato-history';

export type AccessoryType =
  | 'switch' | 'lightbulb' | 'outlet'
  | 'stateless_switch' | 'doorbell'
  | 'contact_sensor' | 'occupancy_sensor' | 'motion_sensor' | 'leak_sensor' | 'smoke_sensor'
  | 'carbon_monoxide_sensor' | 'carbon_dioxide_sensor' | 'temperature_sensor' | 'humidity_sensor' | 'air_quality_sensor'
  | 'light_sensor' | 'battery_service'
  | 'door' | 'garage_door' | 'window' | 'window_covering'
  | 'lock' | 'security_system' | 'fan' | 'heater_cooler' | 'thermostat'
  | 'valve' | 'faucet' | 'irrigation'
  | 'television' | 'speaker';

export interface CharacteristicTopic {
  get?: string;
  set?: string;
  parse?: string;
  apply?: string;
  jsonPath?: string;
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

export interface AccessoryDefinition {
  name: string;
  type: AccessoryType;
  topics: Record<string, CharacteristicTopic>;
  onValue?: unknown;
  offValue?: unknown;
  history?: boolean;
  [key: string]: unknown;
}

interface ServiceDescriptor {
  create: (hap: HAP) => Service;
  chars: readonly string[];
  historyType?: 'thermo' | 'motion' | 'door';
}

export function buildServiceMap(hap: HAP): Record<AccessoryType, ServiceDescriptor> {
  const { Service: S, Characteristic: C } = hap;

  return {
    switch:           { create: () => new S.Switch(),                  chars: ['On'] },
    lightbulb:        { create: () => new S.Lightbulb(),               chars: ['On', 'Brightness'] },
    outlet:           { create: () => new S.Outlet(),                  chars: ['On'] },
    stateless_switch: { create: () => new S.StatelessProgrammableSwitch(), chars: ['ProgrammableSwitchEvent'] },
    doorbell:         { create: () => new S.Doorbell(),                chars: ['ProgrammableSwitchEvent'] },
    contact_sensor:   { create: () => new S.ContactSensor(),           chars: ['ContactSensorState'] },
    occupancy_sensor: { create: () => new S.OccupancySensor(),         chars: ['OccupancyDetected'] },
    motion_sensor:    { create: () => new S.MotionSensor(),            chars: ['MotionDetected'],      historyType: 'motion' },
    leak_sensor:      { create: () => new S.LeakSensor(),              chars: ['LeakDetected'] },
    smoke_sensor:     { create: () => new S.SmokeSensor(),             chars: ['SmokeDetected'] },
    carbon_monoxide_sensor: { create: () => new S.CarbonMonoxideSensor(), chars: ['CarbonMonoxideDetected'] },
    carbon_dioxide_sensor:  { create: () => new S.CarbonDioxideSensor(),  chars: ['CarbonDioxideLevel'] },
    temperature_sensor:     { create: () => new S.TemperatureSensor(),    chars: ['CurrentTemperature'], historyType: 'thermo' },
    humidity_sensor:        { create: () => new S.HumiditySensor(),       chars: ['CurrentRelativeHumidity'] },
    air_quality_sensor:     { create: () => new S.AirQualitySensor(),     chars: ['AirQuality'] },
    light_sensor:           { create: () => new S.LightSensor(),          chars: ['CurrentAmbientLightLevel'] },
    battery_service:        { create: () => new S.BatteryService(),       chars: ['BatteryLevel', 'ChargingState', 'StatusLowBattery'] },
    door:                   { create: () => new S.Door(),                chars: ['TargetPosition', 'CurrentPosition', 'PositionState'], historyType: 'door' },
    garage_door:            { create: () => new S.GarageDoorOpener(),    chars: ['TargetDoorState', 'CurrentDoorState', 'ObstructionDetected'], historyType: 'door' },
    window:                 { create: () => new S.Window(),              chars: ['TargetPosition', 'CurrentPosition', 'PositionState'] },
    window_covering:        { create: () => new S.WindowCovering(),      chars: ['TargetPosition', 'CurrentPosition', 'PositionState'] },
    lock:                   { create: () => new S.LockMechanism(),       chars: ['LockTargetState', 'LockCurrentState'] },
    security_system:        { create: () => new S.SecuritySystem(),      chars: ['SecuritySystemTargetState', 'SecuritySystemCurrentState'] },
    fan:                    { create: () => new S.Fanv2(),               chars: ['Active', 'RotationSpeed', 'RotationDirection'] },
    heater_cooler:          { create: () => new S.HeaterCooler(),        chars: ['Active', 'CurrentTemperature', 'TargetHeaterCoolerState', 'CurrentHeaterCoolerState', 'CoolingThresholdTemperature', 'HeatingThresholdTemperature', 'TargetTemperature'] },
    thermostat:             { create: () => new S.Thermostat(),          chars: ['CurrentTemperature', 'TargetTemperature', 'TargetHeatingCoolingState', 'CurrentHeatingCoolingState'] },
    valve:                  { create: () => new S.Valve(),               chars: ['Active', 'InUse'] },
    faucet:                 { create: () => new S.Faucet(),              chars: ['Active'] },
    irrigation:             { create: () => new S.IrrigationSystem(),    chars: ['ProgramMode', 'InUse'] },
    television:             { create: () => new S.Television(),          chars: ['Active', 'ActiveIdentifier', 'RemoteKey', 'PowerModeSelection'] },
    speaker:                { create: () => new S.TelevisionSpeaker(),   chars: ['Mute', 'VolumeSelector', 'Volume'] },
  } as Record<AccessoryType, ServiceDescriptor>;
}

export function createAccessory(
  accessory: PlatformAccessory,
  def: AccessoryDefinition,
  ctx: { log: Logger; Service: typeof Service; Characteristic: typeof Characteristic; apiHap: HAP; }
): void {
  const { log, Service: S, Characteristic: C } = ctx;
  const hap = { Service: S, Characteristic: C } as HAP;
  const serviceMap = buildServiceMap(hap);
  const desc = serviceMap[def.type];

  if (!desc) {
    log.error(`Unsupported accessory type ${def.type}`);
    return;
  }

  // Attach or create the HomeKit service
  let service = accessory.getService(desc.create(hap).constructor as any);
  if (!service) {
    service = accessory.addService(desc.create(hap), def.name);
  }

  // FakeGato history if requested
  let history: FakeGatoHistoryService | undefined;
  if (def.history && desc.historyType) {
    history = new FakeGatoHistoryService(desc.historyType, accessory, {
      storage: 'fs',
      filename: `${accessory.UUID}.json`,
      log,
    });
  }

  const mqttClient = MQTTConnection.get().client;
  const vm = new VM({ timeout: 100 });

  // Subscribe to and track inbound topics
  const inboundTopics = new Set<string>();
  for (const charName of desc.chars) {
    const cfg = def.topics[charName];
    if (cfg?.get) {
      mqttClient.subscribe(cfg.get, { qos: cfg.qos ?? 0 });
      inboundTopics.add(cfg.get);
    }
  }

  // Outbound (HomeKit → MQTT)
  for (const charName of desc.chars) {
    const characteristic = (C as any)[charName];
    const cfg = def.topics[charName];
    if (cfg?.set) {
      service.getCharacteristic(characteristic).onSet((value: CharacteristicValue) => {
        let out = value;
        if (cfg.apply) {
          try {
            out = vm.run(`(function(value){${cfg.apply}})(${JSON.stringify(value)})`);
          } catch (err) {
            log.error(`apply() error for ${charName}: ${(err as Error).message}`);
            return;
          }
        }
        mqttClient.publish(cfg.set!, String(out), { retain: cfg.retain ?? false, qos: cfg.qos ?? 0 });
      });
    }
  }

  // Inbound (MQTT → HomeKit)
  const handleMessage = (topic: string, message: Buffer) => {
    if (!inboundTopics.has(topic)) {
      return;
    }
    for (const charName of desc.chars) {
      const cfg = def.topics[charName];
      if (cfg?.get === topic) {
        let payload: unknown = message.toString();

        // JSONPath extraction
        if (cfg.jsonPath) {
          try {
            payload = JSONPath({ path: cfg.jsonPath, json: JSON.parse(String(payload)) })[0];
          } catch (err) {
            log.error(`JSONPath error for ${charName}: ${(err as Error).message}`);
          }
        }

        // parse()
        if (cfg.parse) {
          try {
            payload = vm.run(`(function(message){${cfg.parse}})(${JSON.stringify(payload)})`);
          } catch (err) {
            log.error(`parse() error for ${charName}: ${(err as Error).message}`);
            return;
          }
        }

        // Coerce boolean for On
        if (charName === 'On') {
          payload = payload === (def.onValue ?? '1');
        }

        // Update characteristic if supported
        const characteristic = (C as any)[charName];
        if (service.testCharacteristic(characteristic)) {
          service.updateCharacteristic(characteristic, payload as CharacteristicValue);
          history?.addEntry({ time: Math.floor(Date.now() / 1000), [charName]: payload });
        }
      }
    }
  };

  mqttClient.on('message', handleMessage);

  // Cleanup on shutdown
  accessory.once('shutdown', () => {
    mqttClient.off('message', handleMessage);
  });
}
