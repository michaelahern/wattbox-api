export enum OutletAction {
    OFF = 0,
    ON = 1,
    TOGGLE = 2,
    RESET = 3
}

export interface OutletPowerStatus {
    outlet: number;
    watts: number;
    amps: number;
    volts: number;
}

export interface PowerStatus {
    amps: number;
    watts: number;
    volts: number;
    safeVoltageStatus: boolean;
}

export interface UPSStatus {
    batteryCharge: number;
    batteryLoad: number;
    batteryHealthy: boolean;
    powerLost: boolean;
    batteryRuntime: number;
    alarmEnabled: boolean;
    alarmMuted: boolean;
}
