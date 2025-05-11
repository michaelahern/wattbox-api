# WattBox API Client

[![npm](https://badgen.net/npm/v/wattbox-api)](https://www.npmjs.com/package/wattbox-api)
[![npm](https://badgen.net/npm/dt/wattbox-api)](https://www.npmjs.com/package/wattbox-api)
[![node](https://badgen.net/npm/node/wattbox-api)](https://www.npmjs.com/package/wattbox-api)
[![types](https://badgen.net/npm/types/wattbox-api)](https://www.npmjs.com/package/wattbox-api)
[![build](https://github.com/michaelahern/wattbox-api/actions/workflows/build.yml/badge.svg)](https://github.com/michaelahern/wattbox-api/actions/workflows/build.yml)

An unofficial Node.JS client library for [WattBox IP Power](https://www.snapav.com/shop/en/snapav/wattbox-ip-power) devices.

## Docs

https://michaelahern.github.io/wattbox-api/

## Supported Devices

- WB-800 Series
- WB-250 Series
- WB-150 Series

_Note: This plugin implements the WattBox Integration Protocol used by the above series devices, and does not support WB-700 and WB-300 series devices..._

## Installing

```bash
$ npm install wattbox-api
```

## Example

```javascript
import { WattBoxClient, WattBoxOutletAction } from 'wattbox-api';

async function main() {
    const client = new WattBoxClient({
        host: '[HOST]',
        username: '[USERNAME]',
        password: '[PASSWORD]'
    });

    client.on('outletStatus', (outlets) => {
        console.log('Updated Outlet Status:', outlets);
        // Updated Outlet Status: [ true, true, true, true, true, false ]
    });

    await client.connect();

    await client.getModel()
        .then(resp => console.log('Model:', resp))
        .catch(err => console.error(err));
    // Model: WB-800-IPVM-6

    await client.getOutletCount()
        .then(resp => console.log('Outlet Count:', resp))
        .catch(err => console.error(err));
    // Outlet Count: 6

    await client.getOutletStatus()
        .then(resp => console.log('Outlet Status:', resp))
        .catch(err => console.error(err));
    // Outlet Status: [ true, true, true, true, true, true ]

    await client.setOutlet(6, WattBoxOutletAction.OFF)
        .catch(err => console.error(err));
}

main().catch(err => console.error(err));
```
