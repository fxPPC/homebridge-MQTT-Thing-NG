import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Categories,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { AccessoryDefinition, createAccessory } from './thingAccessory';
import { MQTTConnection } from './services/mqtt';

export class MQTTThingPlatform implements DynamicPlatformPlugin {
  private readonly accessories = new Map<string, PlatformAccessory>();

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    if (!config || !Array.isArray(config.accessories)) {
      this.log.error('No accessories array found in config; nothing to do.');
      return;
    }

    MQTTConnection.init(this.log, config.broker || {});
    this.api.on('didFinishLaunching', () => this.discoverDevices(config.accessories));
    this.api.on('shutdown', () => MQTTConnection.get().shutdown());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  private discoverDevices(defs: AccessoryDefinition[]): void {
    this.log.info(`Initialising ${defs.length} MQTT Thing NG accessories…`);
    const activeIds = new Set<string>();

    for (const def of defs) {
      const uuid = this.api.hap.uuid.generate(def.name);
      activeIds.add(uuid);

      if (this.accessories.has(uuid)) {
        createAccessory(this.accessories.get(uuid)!, def, {
          log: this.log,
          Service: this.api.hap.Service,
          Characteristic: this.api.hap.Characteristic,
          apiHap: this.api.hap,
        });
      } else {
        const accessory = new this.api.platformAccessory(def.name, uuid, Categories.OTHER);
        accessory.context.uuid_base = uuid;
        createAccessory(accessory, def, {
          log: this.log,
          Service: this.api.hap.Service,
          Characteristic: this.api.hap.Characteristic,
          apiHap: this.api.hap,
        });
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }
    }

    for (const [uuid, acc] of this.accessories) {
      if (!activeIds.has(uuid)) {
        this.log.info(`Removing stale accessory ${acc.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
        this.accessories.delete(uuid);
      }
    }
  }
}
