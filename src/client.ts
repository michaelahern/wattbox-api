import { EventEmitter } from 'events';
import { Socket } from 'net';

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
        const match = /\?AutoReboot=(\d)/.exec(response);
        return match ? Boolean(parseInt(match[1])) : false;
    }

    /**
     * Protocol Command: ?Firmware
     */
    public async getFirmware(): Promise<string> {
        const response = await this.handleRequestMessage('?Firmware');
        const match = /\?Firmware=(.*)/.exec(response);
        return match ? match[1] : 'Unknown';
    }

    /**
     * Protocol Command: ?Hostname
     */
    public async getHostname(): Promise<string> {
        const response = await this.handleRequestMessage('?Hostname');
        const match = /\?Hostname=(.*)/.exec(response);
        return match ? match[1] : 'Unknown';
    }

    /**
     * Protocol Command: ?Model
     */
    public async getModel(): Promise<string> {
        const response = await this.handleRequestMessage('?Model');
        const match = /\?Model=(.*)/.exec(response);
        return match ? match[1] : 'Unknown';
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
        const match = /\?OutletName=((?:{.*},)+(?:{.*}))/.exec(response);
        return match ? match[1].split(',').map(x => x) : [];
    }

    /**
     * Protocol Command: ?OutletPowerStatus
     */
    public async getOutletPowerStatus(outlet: number): Promise<number[]> {
        const response = await this.handleRequestMessage(`?OutletPowerStatus=${outlet}`);
        const match = /\?OutletPowerStatus=((?:\d+(?:\.\d+)?,)+(?:\d+(?:\.\d+)?))/.exec(response);
        return match ? match[1].split(',').map(x => parseFloat(x)) : [];
    }

    /**
     * Protocol Command: ?OutletStatus
     */
    public async getOutletStatus(): Promise<number[]> {
        const response = await this.handleRequestMessage('?OutletStatus');
        const match = /\?OutletStatus=((?:\d,)*\d)/.exec(response);
        return match ? match[1].split(',').map(x => parseInt(x)) : [];
    }

    /**
     * Protocol Command: ?PowerStatus
     */
    public async getPowerStatus(): Promise<number[]> {
        const response = await this.handleRequestMessage('?PowerStatus');
        const match = /\?PowerStatus=((?:\d+(?:\.\d+)?,)+(?:\d+(?:\.\d+)?))/.exec(response);
        return match ? match[1].split(',').map(x => parseFloat(x)) : [];
    }

    /**
     * Protocol Command: ?ServiceTag
     */
    public async getServiceTag(): Promise<string> {
        const response = await this.handleRequestMessage('?ServiceTag');
        const match = /\?ServiceTag=(.*)/.exec(response);
        return match ? match[1] : 'Unknown';
    }

    private async handleRequestMessage(message: string): Promise<string> {
        if (!this.connected) {
            throw new WattBoxError('Not Connected');
        }

        if (this.socket) {
            this.socket.write(`${message}\n`);
        }

        return new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.socket?.destroy();
                reject(new WattBoxError('Timeout'));
            }, this.opts.timeout ?? 5000);

            this.internalEventEmitter.once(message.split('=')[0], (data: string) => {
                clearTimeout(timeout);
                resolve(data);
            });
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
            const timeout = setTimeout(() => {
                this.socket?.destroy();
                reject(new WattBoxError('Timeout'));
            }, this.opts.timeout ?? 5000);

            this.internalEventEmitter.once('control', (data: boolean) => {
                clearTimeout(timeout);
                if (data) {
                    resolve();
                }
                else {
                    reject(new WattBoxError('Control Failed'));
                }
            });
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
                this.internalEventEmitter.emit('control', true);
                return;
            case '#Error':
                this.internalEventEmitter.emit('control', false);
                return;
        }

        // Unsolicited Messages
        if (message.startsWith('~OutletStatus')) {
            const match = /~OutletStatus=((?:\d,)*\d)/.exec(message);
            if (match) {
                this.emit('outletStatusUpdate', match[1].split(',').map(x => parseInt(x)));
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
    outletStatusUpdate: [outlets: number[]];
    ready: [];
}
