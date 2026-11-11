# Backend

Watcher Solana devnet + relayer NEAR testnet.

## API

### Health

`GET /health`

### NEAR RPC Proxy

`POST /v1/near-rpc`

Proxy HTTP para JSON-RPC de NEAR con fallback entre `NEAR_RPC_URLS*`.
Este endpoint esta pensado para frontend estatico (ej: GitHub Pages) que no puede usar `/api/near-rpc` de Next.

### Acciones de jugadores Solana (relayer MPC)

`POST /v1/solana/actions`

Phantom no puede firmar transacciones NEAR: la cuenta del jugador la controla el backend vía chain signatures. El jugador firma con Phantom (`signMessage`) un mensaje que autoriza la acción y el backend la envía con `sign-with-mpc`.

```json
{
	"solanaAddress": "<address>",
	"message": "NEARena action\n{\"v\":1,\"contract\":\"nearena-v1.testnet\",\"method\":\"buy_items\",\"args\":{...},\"nonce\":\"<uuid>\",\"issuedAt\":\"<ISO>\"}",
	"signature": "<firma ed25519 en base58>"
}
```

Valida firma, contrato, método (`buy_items`, `apply_inventory_actions`, `challenge`, `assign_stat_points`), antigüedad ≤ 5 min y nonce no reutilizado. Responde `{ "txHash", "signerId", "method" }`.

### Crear jugador derivado desde Solana

`POST /v1/players/solana-derived`

Body opcional:

```json
{
	"solanaAddress": "C2jKTLDFrZw9sMPRUKeK4Trc3QWeeoWh3YofaC5thJi5"
}
```

Si no se envía `solanaAddress`, el backend genera un keypair temporal para derivar.

Respuesta:

```json
{
	"contractAccountId": "nearena-v1.testnet",
	"playerAccountId": "...implicit account...",
	"alreadyRegistered": false,
	"fundingTxHash": "...",
	"registerPlayerTxHash": "...",
	"proof": {
		"solanaAddress": "...",
		"derivationPath": "solana:...",
		"mpcDerivedPublicKey": "ed25519:...",
		"implicitNearAccountId": "...",
		"txSigner": "...",
		"match": true
	}
}
```

`proof.match=true` valida objetivamente que la cuenta implícita derivada coincide con el signer real de la tx on-chain.

## Correr local

```bash
npm run start --workspace @gladiator/backend
```

## Correr backend con PM2

Desde la raiz del monorepo:

```bash
npm install
npm run pm2:start
```

Comandos utiles:

```bash
npm run pm2:status
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
```

Persistir PM2 al reinicio del server:

```bash
npx pm2 save
npx pm2 startup
```

Notas:

- PM2 usa la configuracion en `ecosystem.config.cjs`.
- El proceso que se levanta es `npm run start --workspace @gladiator/backend`.
- PM2 carga variables desde `.env` automaticamente (`env_file: .env`).
- Asegurate de definir las variables requeridas (`NETWORK_NAME`, `CONTRACT_ACCOUNT_ID`, `SIGNER_ACCOUNT_ID`, `NEAR_MPC_CONTRACT_ID`, etc.).
- Para frontend en otro dominio (ej: `*.github.io`), define `BACKEND_CORS_ALLOWED_ORIGINS` con ese origen.
