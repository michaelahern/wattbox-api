import { EventEmitter } from 'events';
import { Socket } from 'net';
import { WattBoxOutletAction } from './schemas.js';
import type { WattBoxOutletMode, WattBoxOutletPowerMetrics, WattBoxPowerMetrics, WattBoxUPSMetrics } from './schemas.js';

export class WattBoxClient extends EventEmitter<WattBoxEvents> {
    private opts: WattBoxClientOpts;

    private bcc: EventEmitter = new EventEmitter();
    private connected = false;
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private socket: Socket | null = null;

    constructor(opts: WattBoxClientOpts) {
        super();
        this.opts = opts;
    }

    /**
     * Establish a connection to the WattBox.
     *
     * @remarks
     * Will attempt to connect to the WattBox using the provided host, username, and password.
     * Will attempt to automatically reconnect if the connection is lost.
     *
     * @throws {@link WattBoxError} If the connection fails or if the login is invalid.
     */
    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = new Socket();
            this.socket.setEncoding('utf8');
            this.socket.setKeepAlive(true, this.opts.timeout ?? 5000);
            this.socket.setTimeout(this.opts.timeout ?? 5000);

            this.socket.on('connect', () => {
                this.emit('debugsock', 'connect');
                this.connected = true;
                this.reconnectAttempts = 0;
            });

            this.bcc.removeAllListeners('login');
            this.bcc.once('login', (success: boolean) => {
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
                this.emit('debugsock', 'data', data);
                this.handleData(data);
            });

            this.socket.on('timeout', () => {
                if (!this.connected) {
                    this.emit('debugsock', 'timeout');
                    this.socket?.destroy();
                }
            });

            this.socket.on('close', () => {
                this.emit('debugsock', 'close');
                this.connected = false;
                if (this.reconnectAttempts >= 0) {
                    const maxReconnectAttempts = this.opts.maxReconnectAttempts ?? Infinity;
                    if (this.reconnectAttempts >= maxReconnectAttempts) {
                        return;
                    }

                    this.reconnectAttempts++;
                    const reconnectBackoff = Math.min(32, Math.pow(2, this.reconnectAttempts)) * 1000; // 2, 4, 8, 16, 32, 32, ...
                    this.emit('debugsock', 'reconnect', `#${this.reconnectAttempts}/${maxReconnectAttempts} in ${reconnectBackoff / 1000}s`);

                    this.reconnectTimer = setTimeout(() => {
                        this.connect().catch();
                    }, reconnectBackoff);
                }
            });

            this.socket.on('error', (err) => {
                this.emit('debugsock', 'error', err.message);
                if (!this.connected) {
                    reject(err);
                }
            });

            this.socket.connect(23, this.opts.host);
        });
    }

    /**
     * Disconnect from the WattBox.
     */
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
     * Get if auto-reboot is enabled on the WattBox.
     *
     * @remarks
     * Protocol Command: ?AutoReboot
     *
     * @throws {@link WattBoxError}
     */
    public async getAutoReboot(): Promise<boolean> {
        const response = await this.handleRequestMessage('?AutoReboot');
        const match = /\?AutoReboot=([01])/.exec(response);
        return match && match[1] ? Boolean(parseInt(match[1])) : false;
    }

    /**
     * Get the firmware version of the WattBox.
     *
     * @remarks
     * Protocol Command: ?Firmware
     *
     * @throws {@link WattBoxError}
     */
    public async getFirmware(): Promise<string> {
        const response = await this.handleRequestMessage('?Firmware');
        const match = /\?Firmware=(.*)/.exec(response);
        return match && match[1] ? match[1] : '';
    }

    /**
     * Get the hostname of the WattBox.
     *
     * @remarks
     * Protocol Command: ?Hostname
     *
     * @throws {@link WattBoxError}
     */
    public async getHostname(): Promise<string> {
        const response = await this.handleRequestMessage('?Hostname');
        const match = /\?Hostname=(.*)/.exec(response);
        return match && match[1] ? match[1] : '';
    }

    /**
     * Get the model number of the WattBox.
     *
     * @remarks
     * Protocol Command: ?Model
     *
     * @throws {@link WattBoxError}
     */
    public async getModel(): Promise<string> {
        const response = await this.handleRequestMessage('?Model');
        const match = /\?Model=(.*)/.exec(response);
        return match && match[1] ? match[1] : '';
    }

    /**
     * Get the number of outlets on the WattBox.
     *
     * @remarks
     * Protocol Command: ?OutletCount
     *
     * @throws {@link WattBoxError}
     */
    public async getOutletCount(): Promise<number> {
        const response = await this.handleRequestMessage('?OutletCount');
        const match = /\?OutletCount=(\d+)/.exec(response);
        return match && match[1] ? parseInt(match[1]) : 0;
    }

    /**
     * Get the names of all outlets on the WattBox.
     *
     * @remarks
     * Protocol Command: ?OutletName
     *
     * @throws {@link WattBoxError}
     */
    public async getOutletNames(): Promise<string[]> {
        const response = await this.handleRequestMessage('?OutletName');
        const match = /\?OutletName=(.*)/.exec(response);
        return match && match[1] ? match[1].split(',').map(x => x.slice(1, -1)) : [];
    }

    /**
     * Get the power metrics for a specific outlet.
     *
     * @param outlet - The outlet number (1-indexed)
     *
     * @remarks
     * Protocol Command: ?OutletPowerStatus
     *
     * Not supported on WB150/250
     *
     * @throws {@link WattBoxError}
     */
    public async getOutletPowerMetrics(outlet: number): Promise<WattBoxOutletPowerMetrics | null> {
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
     * Get the status of all outlets, where the array index is the outlet number (0-indexed)
     * and the value at the index indicates the outlet state (Off = false, On = true).
     *
     * @param outlet - The outlet number (1-indexed)
     *
     * @remarks
     * Protocol Command: ?OutletStatus
     *
     * @throws {@link WattBoxError}
     */
    public async getOutletStatus(): Promise<boolean[]> {
        const response = await this.handleRequestMessage('?OutletStatus');
        const match = /\?OutletStatus=((?:[01],)*[01])/.exec(response);
        return match && match[1] ? match[1].split(',').map(x => Boolean(parseInt(x))) : [];
    }

    /**
     * Get the power metrics for the WattBox.
     *
     * @remarks
     * Protocol Command: ?PowerStatus
     *
     * NOTE: Not supported on WB150/250
     *
     * @throws {@link WattBoxError}
     */
    public async getPowerMetrics(): Promise<WattBoxPowerMetrics | null> {
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
     * Get the service tag of the WattBox.
     *
     * @remarks
     * Protocol Command: ?ServiceTag
     *
     * @throws {@link WattBoxError}
     */
    public async getServiceTag(): Promise<string> {
        const response = await this.handleRequestMessage('?ServiceTag');
        const match = /\?ServiceTag=(.*)/.exec(response);
        return match && match[1] ? match[1] : '';
    }

    /**
     * Get if a UPS has been attached to the WattBox.
     *
     * @remarks
     * Protocol Command: ?UPSConnection
     *
     * @throws {@link WattBoxError}
     */
    public async getUPSConnected(): Promise<boolean> {
        const response = await this.handleRequestMessage('?UPSConnection');
        const match = /\?UPSConnection=([01])/.exec(response);
        return match && match[1] ? Boolean(parseInt(match[1])) : false;
    }

    /**
     * Get the UPS status if a UPS is attached to the WattBox.
     *
     * @remarks
     * Protocol Command: ?UPSStatus
     *
     * @throws {@link WattBoxError}
     */
    public async getUPSMetrics(): Promise<WattBoxUPSMetrics | null> {
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
            this.emit('debugmsg', `[--->] ${message}`);
            this.socket.write(`${message}\n`);
        }

        return new Promise<string>((resolve, reject) => {
            const onTimeout = setTimeout(() => {
                this.socket?.destroy();
                reject(new WattBoxError('Timeout'));
            }, this.opts.timeout ?? 5000);

            const onRequest = (data: string) => {
                this.bcc.removeListener('error', onError);
                clearTimeout(onTimeout);
                resolve(data);
            };

            const onError = () => {
                this.bcc.removeListener(message.split('=')[0], onRequest);
                clearTimeout(onTimeout);
                reject(new WattBoxError('Request Error'));
            };

            Promise.race([
                this.bcc.once(message.split('=')[0], onRequest),
                this.bcc.once('error', onError)
            ]);
        });
    }

    /**
     * Reboot the WattBox device immediately. The client will loose the
     * connection to the device until it is back online.
     *
     * @remarks
     * Protocol Command: !Reboot
     *
     * @throws {@link WattBoxError}
     */
    public async reboot(): Promise<void> {
        await this.handleControlMessage(`!Reboot`);
    }

    /**
     * Set auto reboot configuration on the WattBox.
     *
     * @param autoReboot - Enable or disable auto reboot
     *
     * @remarks
     * Protocol Command: !AutoReboot=<autoReboot>
     *
     * @throws {@link WattBoxError}
     */
    public async setAutoReboot(autoReboot: boolean): Promise<void> {
        await this.handleControlMessage(`!AutoReboot=${autoReboot ? 1 : 0}`);
    }

    /**
     * Execute an action on a specific outlet.
     *
     * To reset all outlets, set outlet to 0 and action to WattBoxOutletAction.RESET.
     *
     * @param outlet - The outlet number (1-indexed) or 0 for all outlets
     * @param action - The action to perform on the outlet (OFF, ON, TOGGLE, RESET)
     *
     * @remarks
     * Protocol Command: !OutletSet=<outlet>,<action>
     *
     * @throws {@link WattBoxError}
     */
    public async setOutletAction(outlet: number, action: WattBoxOutletAction): Promise<void> {
        await this.handleControlMessage(`!OutletSet=${outlet},${WattBoxOutletAction[action]}`);
    }

    /**
     * Set the operating mode for a specific outlet.
     *
     * @param outlet - The outlet number (1-indexed)
     * @param mode - The mode to configure on the outlet (ENABLED, DISABLED, RESET_ONLY)
     *
     * @remarks
     * Protocol Command: !OutletModeSet=<outlet>,<mode>
     *
     * @throws {@link WattBoxError}
     */
    public async setOutletMode(outlet: number, mode: WattBoxOutletMode): Promise<void> {
        await this.handleControlMessage(`!OutletModeSet=${outlet},${mode}`);
    }

    /**
     * Set the name for a specific outlet.
     *
     * @param outlet - The outlet number (1-indexed)
     * @param name - The outlet name
     *
     * @remarks
     * Protocol Command: !OutletNameSet=<outlet>,<name>
     *
     * @throws {@link WattBoxError}
     */
    public async setOutletName(outlet: number, name: string): Promise<void> {
        await this.handleControlMessage(`!OutletNameSet=${outlet},${name}`);
    }

    /**
     * Set the power on delay for a specific outlet.
     *
     * @param outlet - The outlet number (1-indexed)
     * @param delay - Power on delay in seconds, accepts values between 1 and 600
     *
     * @remarks
     * Protocol Command: !OutletPowerOnDelaySet=<outlet>,<delay>
     *
     * @throws {@link WattBoxError}
     */
    public async setOutletPowerOnDelay(outlet: number, delay: number): Promise<void> {
        await this.handleControlMessage(`!OutletPowerOnDelaySet=${outlet},${Math.trunc(delay)}`);
    }

    private async handleControlMessage(message: string): Promise<void> {
        if (!this.connected) {
            throw new WattBoxError('Not Connected');
        }

        if (this.socket) {
            this.emit('debugmsg', `[--->] ${message}`);
            this.socket.write(`${message}\n`);
        }

        return new Promise<void>((resolve, reject) => {
            const onTimeout = setTimeout(() => {
                this.socket?.destroy();
                reject(new WattBoxError('Timeout'));
            }, this.opts.timeout ?? 5000);

            const onOk = () => {
                this.bcc.removeListener('error', onError);
                clearTimeout(onTimeout);
                resolve();
            };

            const onError = () => {
                this.bcc.removeListener('ok', onOk);
                clearTimeout(onTimeout);
                reject(new WattBoxError('Control Error'));
            };

            Promise.race([
                this.bcc.once('ok', onOk),
                this.bcc.once('error', onError)
            ]);
        });
    }

    private handleData(data: string): void {
        const message = data.trim();

        // Handle Multiple Messages
        // Example: OK\n~OutletStatus=1,1,1,1,1,1
        if (message.split('\n').length > 1) {
            message.split('\n').forEach(msg => this.handleData(msg));
            return;
        }

        // Login Prompts & Messages
        switch (message) {
            case 'Please Login to Continue':
                return;
            case 'Username:':
                if (this.socket) {
                    this.socket.write(`${this.opts.username}\n`);
                }
                return;
            case 'Password:':
                if (this.socket) {
                    this.socket.write(`${this.opts.password}\n`);
                }
                return;
            case 'Successfully Logged In!':
                this.bcc.emit('login', true);
                return;
            case 'Invalid Login':
                this.bcc.emit('login', false);
                return;
        }

        // Emit Non-Login Messages
        this.emit('debugmsg', `[<---] ${message}`);

        // Request Messages
        if (message.startsWith('?')) {
            this.bcc.emit(message.split('=')[0], message);
            return;
        }

        // Control Messages
        switch (message) {
            case 'OK':
                this.bcc.emit('ok');
                return;
            case '#Error':
                this.bcc.emit('error');
                return;
        }

        // Unsolicited Messages
        if (message.startsWith('~OutletStatus')) {
            const match = /~OutletStatus=((?:[01],)*[01])/.exec(message);
            if (match && match[1]) {
                this.emit('outletStatus', match[1].split(',').map(x => Boolean(parseInt(x))));
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
    /** Emit debug logs for WattBox messages */
    debugmsg: [message: string];
    /** Emit debug logs for socket events */
    debugsock: [event: string, payload?: string];
    /** Emitted when outlet status changes. */
    outletStatus: [outlets: boolean[]];
    /** Emitted when client is connected or reconnected. */
    ready: [];
}
