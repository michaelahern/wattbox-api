#!/usr/bin/env node
import { styleText } from 'node:util';
import { WattBoxClient } from './client.js';

async function main() {
    const client = new WattBoxClient({
        host: '[HOST]',
        username: '[USERNAME]',
        password: '[PASSWORD]'
    });

    client.on('debugMessage', (message: string) => {
        console.debug(styleText('dim', `Debug [Message]: ${message}`));
    });

    client.on('debugSocket', (event: string, message: string) => {
        console.debug(styleText('dim', `Debug [Socket ]: [${event}] ${message ? message.replace('\n', '\\n') : ''}`));
    });

    client.on('outletStatusUpdate', (status: number[]) => {
        console.log(`Outlet Status Updated: ${status}`);
    });

    client.on('ready', async () => {
        console.log('WattBox Ready!');
    });

    await client.connect();
    console.log(`Firmware: ${await client.getFirmware().catch(err => console.error(err))}`);
    console.log(`Hostname: ${await client.getHostname().catch(err => console.error(err))}`);
    console.log(`Model: ${await client.getModel().catch(err => console.error(err))}`);
    console.log(`Outlet Count: ${await client.getOutletCount().catch(err => console.error(err))}`);
    console.log(`Outlet Status: ${await client.getOutletStatus().catch(err => console.error(err))}`);
    console.log(`Service Tag: ${await client.getServiceTag().catch(err => console.error(err))}`);

    setInterval(async () => {
        await client.getOutletStatus().then((status) => {
            console.log(`Outlet Status: ${status}`);
        }).catch((err) => {
            console.error(err);
        });
    }, 10000);
}

main().catch(err => console.error(err));
