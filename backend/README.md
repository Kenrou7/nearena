# Backend

Watcher Solana devnet + relayer NEAR testnet.

## API

### Health

`GET /health`

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
