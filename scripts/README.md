# Scripts

## Chain Signatures spike (NEAR testnet -> Solana devnet)

Este spike valida:

1. Derivación de clave pública por path (`solana:{accountId}`).
2. Construcción de mensaje determinístico a firmar.
3. Solicitud de firma al contrato MPC.
4. Verificación local de la firma Ed25519.
5. Derivación de dirección Solana desde la clave pública.

## Variables de entorno

- `NEAR_RPC_URL` (default: `https://rpc.testnet.near.org`)
- `NEAR_NETWORK_ID` (default: `testnet`)
- `NEAR_MPC_CONTRACT_ID` (ej: `v1.signer-prod.testnet`, ajustar según entorno)
- `NEAR_SIGNER_ACCOUNT_ID` (cuenta testnet usada por el relayer/spike)
- `NEAR_SIGNER_PRIVATE_KEY` (clave privada de la cuenta signer)
- `CHAIN_SIGNATURES_PUBLIC_KEY_METHOD` (default recomendado: `derived_public_key`)
- `CHAIN_SIGNATURES_SIGN_METHOD` (default: `sign`)
- `CHAIN_SIGNATURES_DOMAIN_ID` (default: `1` para Ed25519/Solana)

## Ejecutar

```bash
set -a
source scripts/.env
set +a

npm run spike:chain-signatures --workspace @gladiator/scripts -- --account demo-player.testnet --nonce 1
```

## Validar MPC contract id antes del spike

Con `near-cli` (si lo tenes instalado):

```bash
near contract call-function as-read-only "$NEAR_MPC_CONTRACT_ID" state json-args '{}' network-config testnet now
```

Con RPC directo (sin near-cli):

```bash
curl -s https://rpc.testnet.near.org \
	-H 'Content-Type: application/json' \
	-d '{
		"jsonrpc":"2.0",
		"id":"dontcare",
		"method":"query",
		"params":{
			"request_type":"call_function",
			"finality":"final",
			"account_id":"'"$NEAR_MPC_CONTRACT_ID"'",
			"method_name":"public_key",
			"args_base64":"e30="
		}
	}'
```

Si devuelve resultado sin error de "account does not exist" o "method not found", el ID es válido para probar.

## Notas

- Este spike no transmite una transacción en Solana todavía; valida derivación y firma MPC como primer hito de riesgo.
- El siguiente bloque conectará esta firma al armado/envío de transferencia SPL en devnet.
