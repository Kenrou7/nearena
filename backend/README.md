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
