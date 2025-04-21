import mqttConn from 'mqtt-connection';
import { API, LogLevel } from 'homebridge';
import { MQTTConnection } from '../src/services/mqtt';
import { createAccessory } from '../src/thingAccessory';

const broker = mqttConn();

jest.spyOn(MQTTConnection as any, 'init').mockImplementation(() => {
  const log = console as any;
  const conn: any = { client: broker, log };
  (MQTTConnection as any).instance = conn;
  return conn;
});

describe('MQTT Switch', () => {
  it('publishes On command', (done) => {
    const api = new API(LogLevel.ERROR);
    const mockAcc: any = {
      addService: jest.fn(() => ({
        getCharacteristic: () => ({
          onSet: (cb: any) => { cb(true); },
        }),
      })),
      getService: jest.fn(),
      context: {},
      once: jest.fn(),
    };

    const def = {
      name: 'Test Switch',
      type: 'switch',
      topics: { On: { set: 'test/set' } },
      onValue: '1',
      offValue: '0',
    } as any;

    broker.on('publish', (packet: any) => {
      expect(packet.topic).toBe('test/set');
      expect(packet.payload.toString()).toBe('true');
      done();
    });

    createAccessory(mockAcc, def, {
      log: console as any,
      Service: api.hap.Service,
      Characteristic: api.hap.Characteristic,
      apiHap: api.hap,
    });
  });
});
