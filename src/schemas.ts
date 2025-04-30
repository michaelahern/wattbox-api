export enum WattBoxOutletAction {
    OFF = 0,
    ON = 1,
    TOGGLE = 2,
    RESET = 3
}

export interface WattBoxOutletPowerStatus {
    outlet: number;
    watts: number;
    amps: number;
    volts: number;
}

export interface WattBoxPowerStatus {
    amps: number;
    watts: number;
    volts: number;
    safeVoltageStatus: boolean;
}

export interface WattBoxUPSStatus {
    batteryCharge: number;
    batteryLoad: number;
    batteryHealthy: boolean;
    powerLost: boolean;
    batteryRuntime: number;
    alarmEnabled: boolean;
    alarmMuted: boolean;
}
