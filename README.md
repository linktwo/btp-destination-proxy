# btp-destination-proxy

UI5 Tooling server middleware that forwards requests from the local dev server (`fiori run`, `ui5 serve`) to an SAP BTP destination, like the approuter does on BTP.

- **OnPremise destinations** reach the backend through the Cloud Connector. The middleware opens a `cf ssh -L` tunnel through an SSH-enabled CF app to the BTP Connectivity proxy, which is only reachable from inside Cloud Foundry.
- **Internet destinations** are called directly.
- Destination URL, proxy type, Cloud Connector location ID and `sap-client` come from BTP. You only configure path and destination name, like in `fiori-tools-proxy`.
- No secrets in the project: service keys are read with your `cf login` at runtime.

```
browser -> ui5 dev server -> btp-destination-proxy -> cf ssh tunnel -> Connectivity proxy -> Cloud Connector -> backend
```

## Requirements

- Node.js 20.12 or later, UI5 Tooling v3 or later (specVersion 3.0+ in the project)
- cf CLI v8 on the `PATH`, logged in (`cf login`) and targeting the space with the service instances below

## One-time BTP setup

Per CF space, shared by all developers and projects:

1. **Tunnel app**: a running CF app with SSH enabled (see [Tunnel app](#tunnel-app) below).
2. **Connectivity service** with a key:
   ```powershell
   cf create-service connectivity lite my-connectivity
   cf create-service-key my-connectivity local-dev
   ```
3. **Destination service** with a key. Any `lite` instance can read the destinations at subaccount level:
   ```powershell
   cf create-service destination lite my-destination
   cf create-service-key my-destination local-dev
   ```

### Tunnel app

The tunnel runs through any CF app with SSH enabled. The app only lends its container network to reach the Connectivity proxy, so it needs no code, no route and no service bindings. Use a dedicated app rather than a real one: restaging or redeploying an app closes all tunnels through it.

Create a folder with this `manifest.yml`:

```yaml
---
applications:
  - name: btp-destination-proxy-app
    memory: 64M
    disk_quota: 256M
    instances: 1
    buildpacks:
      - binary_buildpack
    command: sleep infinity
    no-route: true
    health-check-type: process
```

The binary buildpack needs at least one more file in the folder, e.g. an empty `README.md`. Then deploy it and enable SSH:

```powershell
cf push
cf enable-ssh btp-destination-proxy-app
cf restart btp-destination-proxy-app
```

Check that SSH works:

```powershell
cf ssh btp-destination-proxy-app -c "echo ok"
```

If this fails, SSH may be disabled for the space. Check with `cf space-ssh-allowed <space>`.

## Use in a UI5 project

Install the package as dev dependency from GitHub:

```powershell
npm install -D github:linktwo/btp-destination-proxy
```

npm builds the package during installation. This adds the following to the project's `package.json`:

```json
"devDependencies": {
  "btp-destination-proxy": "github:linktwo/btp-destination-proxy"
}
```

`package-lock.json` pins the installed commit. To get the latest `main`, run the install command again. To pin a specific version in `package.json`, append a tag or commit hash, e.g. `github:linktwo/btp-destination-proxy#v0.1.0`.

Configure it in `ui5-local.yaml`. The `backend` entries work like those of `fiori-tools-proxy`: move them over and drop the `url`.

```yaml
server:
  customMiddleware:
    - name: btp-destination-proxy
      afterMiddleware: compression
      configuration:
        destinationService: my-destination
        connectivityService: my-connectivity
        tunnelApp: btp-destination-proxy-app
        backend:
          - path: /sap
            destination: ERP_DEV
    - name: fiori-tools-proxy
      afterMiddleware: compression
      configuration:
        ui5:
          path: [/resources, /test-resources]
          url: https://ui5.sap.com
```

Start as usual, e.g. `fiori run --config ui5-local.yaml --open index.html`. The log shows when the tunnel is open:

```
info btp-destination-proxy Tunnel open: 127.0.0.1:57210 -> 10.0.4.5:20003 via btp-destination-proxy-app
info btp-destination-proxy /sap -> destination "ERP_DEV" (OnPremise, http://erp-dev:8000), backend auth: sent by the client, otherwise basic auth from BTP_PROXY_USER
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `backend` | required | List of `{ path, destination, client }`, see below |
| `destinationService` | required | Destination service instance used for the lookup |
| `destinationServiceKey` | `local-dev` | Service key of that instance |
| `connectivityService` | | Connectivity service instance. Required for OnPremise destinations |
| `connectivityServiceKey` | `local-dev` | Service key of that instance |
| `tunnelApp` | | CF app with SSH enabled. Required for OnPremise destinations |
| `envFile` | `.env` | File with backend credentials, relative to the project root |

Per `backend` entry:

| Option | Default | Description |
|---|---|---|
| `path` | required | Request path forwarded to the destination, including everything below it. Use this instead of `mountPath` |
| `destination` | required | Name of the BTP destination |
| `client` | destination property `sap-client` | Added as `sap-client` query parameter if the request has none |

A request goes to the entry with the longest matching path, whatever the order in the list. All OnPremise destinations share one tunnel:

```yaml
        backend:
          - path: /sap
            destination: ERP_DEV
          - path: /sap/opu/odata/sap/ZOTHER_SRV
            destination: OTHER_SYSTEM
            client: "200"
```

## Backend authentication

In this order:

1. **Destination credentials**: if the destination service resolves an auth header (e.g. `BasicAuthentication`, `OAuth2ClientCredentials`), it is always used, like the approuter does.
2. **Credentials sent by the client**: an `Authorization` header in the request is passed through unchanged. This covers the browser's basic auth popup and tools that bring their own credentials, such as the `deploy-to-abap` task.
3. **`.env` file**: requests without credentials get the backend user from the project's `.env` (see [.env.example](.env.example)). With it, the browser shows no popup. Environment variables with the same names take precedence over the file.
   ```
   BTP_PROXY_USER=MYUSER
   BTP_PROXY_PASSWORD=secret
   ```
   Add `.env` to the project's `.gitignore`.

Without destination credentials and `.env`, the backend's basic auth popup appears in the browser.

If the browser still has credentials cached from an earlier popup on the same `localhost` port, it sends them, and they win over `.env`. Close the browser or use a private window to get rid of them.

`PrincipalPropagation` is not supported yet. Such destinations fall back to 2 or 3.

## How the tunnel behaves

- It opens when the dev server starts (in the background) and is reused for all requests.
- It listens on a free local port, so several projects can run side by side.
- If it closes (network change, expired cf session), the next request opens it again.
- It is closed when the dev server stops, including Ctrl+C. On Windows the whole `cf` process tree is killed.

## Troubleshooting

| Error | Cause |
|---|---|
| `Not logged in to Cloud Foundry` | Run `cf login` and target the space. |
| `Service key ... not found` | Create it with the command shown in the message. |
| `cf ssh ... failed` | App not running or SSH disabled: `cf enable-ssh <app>`, `cf restart <app>`. Also check `cf space-ssh-allowed`. |
| 503 mentioning the location ID | The destination has no `CloudConnectorLocationId`, but the Cloud Connector uses one. |
| 403 from the Cloud Connector | Virtual host, port or path not allowed in the Cloud Connector access control. |
| Token or destination requests time out | Behind a corporate proxy, set `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1` (Node 24+). |

Run with `--verbose` (`fiori run --verbose` / `ui5 serve --verbose`) to see every forwarded request and the `cf ssh` output.

## Security

The Connectivity and destination service keys contain client secrets. They stay in BTP and are only read into memory at runtime. The tunnel makes the Connectivity proxy reachable from your laptop for as long as the dev server runs. What can be reached is still limited by the Cloud Connector access control.

## Development

```powershell
npm install        # also builds dist/
npm test           # runs the TypeScript tests directly (Node 22.18+)
npm run typecheck
npm run build
```
