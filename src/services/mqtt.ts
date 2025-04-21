import { Logger } from 'homebridge';
import mqtt, { MqttClient, IClientOptions } from 'mqtt';

export interface BrokerConfig {
  host?: string;
  port?: number;
  url?: string;
  username?: string;
  password?: string;
  tls?: boolean;
  clientId?: string;
}

export class MQTTConnection {
  private static instance: MQTTConnection;
  public client!: MqttClient;

  private constructor(private readonly log: Logger) {}

  static init(log: Logger, cfg: BrokerConfig): MQTTConnection {
    if (this.instance) { return this.instance; }
    this.instance = new MQTTConnection(log);
    this.instance.connect(cfg);
    return this.instance;
  }

  static get(): MQTTConnection {
    if (!this.instance) {
      throw new Error('MQTT connection has not been initialised');
    }
    return this.instance;
  }

  private connect(cfg: BrokerConfig): void {
    const url = cfg.url ?? `${cfg.tls ? 'mqtts' : 'mqtt'}://${cfg.host ?? 'localhost'}:${cfg.port ?? 1883}`;
    const options: IClientOptions = {
      username: cfg.username,
      password: cfg.password,
      clientId: cfg.clientId ?? `mqttthingng_${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 5_000,
      clean: true,
    };

    this.log.info(`Connecting to MQTT broker at ${url}`);
    this.client = mqtt.connect(url, options);

    this.client.on('connect', () => this.log.info('MQTT connected'));
    this.client.on('reconnect', () => this.log.warn('Reconnecting to MQTT broker…'));
    this.client.on('error', (err) => this.log.error(`MQTT error: ${err.message}`));
    this.client.on('offline', () => this.log.warn('MQTT offline'));
  }

  public shutdown(): void {
    this.log.info('Closing MQTT connection');
    this.client.end(true);
  }
}
