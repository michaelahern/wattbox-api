import { EventEmitter } from 'events';
import { Socket } from 'net';

export class WattBoxClient extends EventEmitter {
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
            this.socket.setTimeout(this.opts.timeout ?? 5000);
            this.socket.setKeepAlive(true, 1000);

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
                    this.attemptReconnect();
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

    public async getFirmware(): Promise<string> {
        const response = await this.handleRequestMessage('?Firmware');
        const match = /\?Firmware=(.*)/.exec(response);
        return match ? match[1] : 'Unknown';
    }

    public async getHostname(): Promise<string> {
        const response = await this.handleRequestMessage('?Hostname');
        const match = /\?Hostname=(.*)/.exec(response);
        return match ? match[1] : 'Unknown';
    }

    public async getModel(): Promise<string> {
        const response = await this.handleRequestMessage('?Model');
        const match = /\?Model=(.*)/.exec(response);
        return match ? match[1] : 'Unknown';
    }

    public async getOutletCount(): Promise<number> {
        const response = await this.handleRequestMessage('?OutletCount');
        const match = /\?OutletCount=(.*)/.exec(response);
        return match ? parseInt(match[1]) : 0;
    }

    public async getOutletStatus(): Promise<number[]> {
        const response = await this.handleRequestMessage('?OutletStatus');
        const match = /\?OutletStatus=(.*)/.exec(response);
        return match ? match[1].split(',').map(x => parseInt(x)) : [];
    }

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

            this.internalEventEmitter.once(message, (data: string) => {
                clearTimeout(timeout);
                resolve(data);
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
                break;
            case 'Invalid Login':
                this.internalEventEmitter.emit('login', false);
                break;
        }

        // Request Messages
        if (message.startsWith('?')) {
            this.emit('debugMessage', message);
            this.internalEventEmitter.emit(message.split('=')[0], message);
        }

        // Unsolicited Messages
        if (message.startsWith('~')) {
            this.emit('debugMessage', message);
            const outletStatusMatch = /~OutletStatus=(.*)/.exec(message);
            if (outletStatusMatch) {
                this.emit('outletStatusUpdate', outletStatusMatch[1].split(',').map(x => parseInt(x)));
            }
        }
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts >= (this.opts.maxReconnectAttempts ?? Infinity)) {
            return;
        }

        this.reconnectAttempts++;
        const reconnectDelay = Math.min(32, Math.pow(2, this.reconnectAttempts)) * 1000;
        this.emit('debugSocket', 'reconnect', `Attempt ${this.reconnectAttempts}/${(this.opts.maxReconnectAttempts ?? Infinity)} in ${reconnectDelay / 1000}s`);

        this.reconnectTimer = setTimeout(() => {
            this.connect().catch();
        }, reconnectDelay);
    }
}

export interface WattBoxClientOpts {
    host: string;
    username: string;
    password: string;
    maxReconnectAttempts?: number;
    timeout?: number;
}

export class WattBoxError extends Error { }
