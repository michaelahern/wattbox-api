import { styleText } from 'node:util';
import { WattBoxClient /* , WattBoxOutletAction, WattBoxOutletMode */ } from './module.js';

async function main() {
    const host = process.env.WATTBOX_HOST;
    const username = process.env.WATTBOX_USERNAME;
    const password = process.env.WATTBOX_PASSWORD;

    if (!host || !username || !password) {
        console.error('Please set the WATTBOX_HOST, WATTBOX_USERNAME, and WATTBOX_PASSWORD environment variables.');
        process.exit(1);
    }

    const client = new WattBoxClient({
        host: host,
        username: username,
        password: password
    });

    client.on('debugmsg', (message: string) => {
        console.debug(styleText('dim', `Debug [data]: ${message}`));
    });

    client.on('debugsock', (event: string, payload?: string) => {
        console.debug(styleText('dim', `Debug [sock]: [${event}] ${payload ? payload.replace(/\n/g, '\\n') : ''}`));
    });

    client.on('outletStatus', (outlets: boolean[]) => {
        console.log('Outlet Status:', outlets);
    });

    client.on('ready', async () => {
        console.log('WattBox Client Ready!');
    });

    await client.connect();
    await client.getAutoReboot().then(resp => console.log('Auto Reboot:', resp)).catch(err => console.error(err));
    await client.getFirmware().then(resp => console.log('Firmware:', resp)).catch(err => console.error(err));
    await client.getHostname().then(resp => console.log('Hostname:', resp)).catch(err => console.error(err));
    await client.getModel().then(resp => console.log('Model:', resp)).catch(err => console.error(err));
    await client.getOutletCount().then(resp => console.log('Outlet Count:', resp)).catch(err => console.error(err));
    await client.getOutletNames().then(resp => console.log('Outlet Names:', resp)).catch(err => console.error(err));
    await client.getOutletPowerMetrics(1).then(resp => console.log('Outlet Power Metrics:', resp)).catch(err => console.error(err));
    await client.getOutletPowerMetrics(2).then(resp => console.log('Outlet Power Metrics:', resp)).catch(err => console.error(err));
    await client.getOutletStatus().then(resp => console.log('Outlet Status:', resp)).catch(err => console.error(err));
    await client.getPowerMetrics().then(resp => console.log('Power Metrics:', resp)).catch(err => console.error(err));
    await client.getServiceTag().then(resp => console.log('Service Tag:', resp)).catch(err => console.error(err));
    await client.getUPSConnected().then(resp => console.log('UPS Connected:', resp)).catch(err => console.error(err));
    await client.getUPSMetrics().then(resp => console.log('UPS Metrics:', resp)).catch(err => console.error(err));

    // await client.reboot().then(() => console.log('Rebooted!')).catch(err => console.error(err));

    // await client.setOutletAction(6, WattBoxOutletAction.RESET).then(() => console.log('Set Outlet 6 Action: RESET')).catch(err => console.error(err));
    // await client.setOutletMode(6, WattBoxOutletMode.ENABLED).then(() => console.log('Set Outlet 6 Mode: ENABLED')).catch(err => console.error(err));
    // await client.setOutletName(6, 'Open').then(() => console.log('Set Outlet 6 Name: Open')).catch(err => console.error(err));
    // await client.setOutletPowerOnDelay(6, 30).then(() => console.log('Set Outlet 6 Power On Delay: 30s')).catch(err => console.error(err));
}

main().catch(err => console.error(err));
