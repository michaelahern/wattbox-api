import { EventEmitter } from 'events';
import { Socket } from 'net';
import { OutletPowerStatus, PowerStatus, UPSStatus } from './schemas.js';

export class WattBoxClient extends EventEmitter<WattBoxEvents> {
    private opts: WattBoxClientOpts;

    private connected = false;
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private socket: Socket | null = null;

    private internalEventEmitter: EventEmitter = new EventEmitter();

    constructor(opts: WattBoxClientOpts) {
        super();
        this.opts = opts;
    }

    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = new Socket();
            this.socket.setEncoding('utf8');
            this.socket.setKeepAlive(true, this.opts.timeout ?? 5000);
            this.socket.setTimeout(this.opts.timeout ?? 5000);

            this.socket.on('connect', () => {
                this.emit('debugSocket', 'connect');
                this.connected = true;
                this.reconnectAttempts = 0;
            });

            this.internalEventEmitter.removeAllListeners('login');
            this.internalEventEmitter.once('login', (success: boolean) => {
                if (success) {
                    this.emit('ready');
                    resolve();
                }
                else {
                    this.reconnectAttempts = -1;
                    this.disconnect();
                    reject(new WattBoxError('Invalid Login'));
                }
            });

            this.socket.on('data', (data: string) => {
                this.emit('debugSocket', 'data', data);
                this.handleData(data);
            });

            this.socket.on('timeout', () => {
                if (!this.connected) {
                    this.emit('debugSocket', 'timeout');
                    this.socket?.destroy();
                }
            });

            this.socket.on('close', () => {
                this.emit('debugSocket', 'close');
                this.connected = false;
                if (this.reconnectAttempts >= 0) {
                    const maxReconnectAttempts = this.opts.maxReconnectAttempts ?? Infinity;
                    if (this.reconnectAttempts >= maxReconnectAttempts) {
                        return;
                    }

                    this.reconnectAttempts++;
                    const reconnectBackoff = Math.min(32, Math.pow(2, this.reconnectAttempts)) * 1000; // 2, 4, 8, 16, 32, 32, ...
                    this.emit('debugSocket', 'reconnect', `#${this.reconnectAttempts}/${maxReconnectAttempts} in ${reconnectBackoff / 1000}s`);

                    this.reconnectTimer = setTimeout(() => {
                        this.connect().catch();
                    }, reconnectBackoff);
                }
            });

            this.socket.on('error', (err) => {
                this.emit('debugSocket', 'error', err.message);
                if (!this.connected) {
                    reject(err);
                }
            });

            this.socket.connect(23, this.opts.host);
        });
    }

    public disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.socket) {
            this.socket.end();
            this.socket = null;
        }

        this.connected = false;
    }

    /**
     * Protocol Command: ?AutoReboot
     */
    public async getAutoReboot(): Promise<boolean> {
        const response = await this.handleRequestMessage('?AutoReboot');
        const match = /\?AutoReboot=([01])/.exec(response);
        return match ? Boolean(parseInt(match[1])) : false;
    }

    /**
     * Protocol Command: ?Firmware
     */
    public async getFirmware(): Promise<string> {
        const response = await this.handleRequestMessage('?Firmware');
        const match = /\?Firmware=(.*)/.exec(response);
        return match ? match[1] : '';
    }

    /**
     * Protocol Command: ?Hostname
     */
    public async getHostname(): Promise<string> {
        const response = await this.handleRequestMessage('?Hostname');
        const match = /\?Hostname=(.*)/.exec(response);
        return match ? match[1] : '';
    }

    /**
     * Protocol Command: ?Model
     */
    public async getModel(): Promise<string> {
        const response = await this.handleRequestMessage('?Model');
        const match = /\?Model=(.*)/.exec(response);
        return match ? match[1] : '';
    }

    /**
     * Protocol Command: ?OutletCount
     */
    public async getOutletCount(): Promise<number> {
        const response = await this.handleRequestMessage('?OutletCount');
        const match = /\?OutletCount=(\d+)/.exec(response);
        return match ? parseInt(match[1]) : 0;
    }

    /**
     * Protocol Command: ?OutletName
     */
    public async getOutletName(): Promise<string[]> {
        const response = await this.handleRequestMessage('?OutletName');
        const match = /\?OutletName=(.*)/.exec(response);
        return match ? match[1].split(',').map(x => x.slice(1, -1)) : [];
    }

    /**
     * Protocol Command: ?OutletPowerStatus
     */
    public async getOutletPowerStatus(outlet: number): Promise<OutletPowerStatus | null> {
        const response = await this.handleRequestMessage(`?OutletPowerStatus=${outlet}`);
        const match = /\?OutletPowerStatus=(\d+),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/.exec(response);

        if (!match || match.length < 5) {
            return null;
        }

        return {
            outlet: parseInt(match[1]),
            watts: parseFloat(match[2]),
            amps: parseFloat(match[3]),
            volts: parseFloat(match[4])
        };
    }

    /**
     * Protocol Command: ?OutletStatus
     */
    public async getOutletStatus(): Promise<boolean[]> {
        const response = await this.handleRequestMessage('?OutletStatus');
        const match = /\?OutletStatus=((?:[01],)*[01])/.exec(response);
        return match ? match[1].split(',').map(x => Boolean(parseInt(x))) : [];
    }

    /**
     * Protocol Command: ?PowerStatus
     */
    public async getPowerStatus(): Promise<PowerStatus | null> {
        const response = await this.handleRequestMessage('?PowerStatus');
        const match = /\?PowerStatus=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(0|1)/.exec(response);

        if (!match || match.length < 5) {
            return null;
        }

        return {
            amps: parseFloat(match[1]),
            watts: parseFloat(match[2]),
            volts: parseFloat(match[3]),
            safeVoltageStatus: Boolean(parseInt(match[4]))
        };
    }

    /**
     * Protocol Command: ?ServiceTag
     */
    public async getServiceTag(): Promise<string> {
        const response = await this.handleRequestMessage('?ServiceTag');
        const match = /\?ServiceTag=(.*)/.exec(response);
        return match ? match[1] : '';
    }

    /**
     * Protocol Command: ?UPSConnection
     */
    public async getUPSConnection(): Promise<boolean> {
        const response = await this.handleRequestMessage('?UPSConnection');
        const match = /\?UPSConnection=([01])/.exec(response);
        return match ? Boolean(parseInt(match[1])) : false;
    }

    /**
     * Protocol Command: ?UPSStatus
     */
    public async getUPSStatus(): Promise<UPSStatus | null> {
        const response = await this.handleRequestMessage('?UPSStatus');
        const match = /\?UPSStatus=(\d+),(\d+),(Good|Bad),(True|False),(\d+),(True|False),(True|False)/.exec(response);

        if (!match || match.length < 8) {
            return null;
        }

        return {
            batteryCharge: parseInt(match[1]),
            batteryLoad: parseInt(match[2]),
            batteryHealthy: match[3] === 'Good',
            powerLost: match[4] === 'True',
            batteryRuntime: parseInt(match[5]),
            alarmEnabled: match[6] === 'True',
            alarmMuted: match[7] === 'True'
        };
    }

    private async handleRequestMessage(message: string): Promise<string> {
        if (!this.connected) {
            throw new WattBoxError('Not Connected');
        }

        if (this.socket) {
            this.socket.write(`${message}\n`);
        }

        return new Promise<string>((resolve, reject) => {
            const onTimeout = setTimeout(() => {
                this.socket?.destroy();
                reject(new WattBoxError('Timeout'));
            }, this.opts.timeout ?? 5000);

            const onRequest = (data: string) => {
                this.internalEventEmitter.removeListener('error', onError);
                clearTimeout(onTimeout);
                resolve(data);
            };

            const onError = () => {
                this.internalEventEmitter.removeListener(message.split('=')[0], onRequest);
                clearTimeout(onTimeout);
                reject(new WattBoxError('Request Error'));
            };

            Promise.race([
                this.internalEventEmitter.once(message.split('=')[0], onRequest),
                this.internalEventEmitter.once('error', onError)
            ]);
        });
    }

    /**
     * Protocol Command: !OutletSet
     */
    public async execOutletSet(outlet: number, action: string): Promise<void> {
        await this.handleControlMessage(`!OutletSet=${outlet},${action}`);
    }

    private async handleControlMessage(message: string): Promise<void> {
        if (!this.connected) {
            throw new WattBoxError('Not Connected');
        }

        if (this.socket) {
            this.socket.write(`${message}\n`);
        }

        return new Promise<void>((resolve, reject) => {
            const onTimeout = setTimeout(() => {
                this.socket?.destroy();
                reject(new WattBoxError('Timeout'));
            }, this.opts.timeout ?? 5000);

            const onOk = () => {
                this.internalEventEmitter.removeListener('error', onError);
                clearTimeout(onTimeout);
                resolve();
            };

            const onError = () => {
                this.internalEventEmitter.removeListener('ok', onOk);
                clearTimeout(onTimeout);
                reject(new WattBoxError('Control Error'));
            };

            Promise.race([
                this.internalEventEmitter.once('ok', onOk),
                this.internalEventEmitter.once('error', onError)
            ]);
        });
    }

    private handleData(data: string): void {
        const message = data.trim();

        // Login Prompts
        if (message.endsWith('Username:')) {
            if (this.socket) {
                this.socket.write(`${this.opts.username}\n`);
            }
            return;
        }

        if (message.endsWith('Password:')) {
            if (this.socket) {
                this.socket.write(`${this.opts.password}\n`);
            }
            return;
        }

        // Login Success & Failure
        switch (message) {
            case 'Successfully Logged In!':
                this.internalEventEmitter.emit('login', true);
                return;
            case 'Invalid Login':
                this.internalEventEmitter.emit('login', false);
                return;
        }

        // Emit Non-Login Messages
        this.emit('debugMessage', message);

        // Request Messages
        if (message.startsWith('?')) {
            this.internalEventEmitter.emit(message.split('=')[0], message);
            return;
        }

        // Control Messages
        switch (message) {
            case 'OK':
                this.internalEventEmitter.emit('ok');
                return;
            case '#Error':
                this.internalEventEmitter.emit('error');
                return;
        }

        // Unsolicited Messages
        if (message.startsWith('~OutletStatus')) {
            const match = /~OutletStatus=((?:[01],)*[01])/.exec(message);
            if (match) {
                this.emit('outletStatusUpdate', match[1].split(',').map(x => Boolean(parseInt(x))));
            }
        }
    }
}

export interface WattBoxClientOpts {
    host: string;
    username: string;
    password: string;
    /** Maximum number of reconnect attempts before giving up, default Infinity */
    maxReconnectAttempts?: number;
    /** Connection and request timeout in milliseconds, default 5000ms (5s) */
    timeout?: number;
}

export class WattBoxError extends Error { }

export interface WattBoxEvents {
    debugMessage: [message: string];
    debugSocket: [event: string, message?: string];
    outletStatusUpdate: [outlets: boolean[]];
    ready: [];
}
