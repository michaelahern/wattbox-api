export enum WattBoxOutletAction {
    OFF = 0,
    ON = 1,
    TOGGLE = 2,
    RESET = 3
}

export interface WattBoxOutletPowerMetrics {
    outlet: number;
    watts: number;
    amps: number;
    volts: number;
}

export interface WattBoxPowerMetrics {
    amps: number;
    watts: number;
    volts: number;
    safeVoltageStatus: boolean;
}

export interface WattBoxUPSMetrics {
    batteryCharge: number;
    batteryLoad: number;
    batteryHealthy: boolean;
    powerLost: boolean;
    batteryRuntime: number;
    alarmEnabled: boolean;
    alarmMuted: boolean;
}
