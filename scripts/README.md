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

## Reset + redeploy del contrato game en testnet

Script operativo para demo end-to-end en `nearena-v1.testnet`:

1. Borra la cuenta destino si ya existe y redirige fondos al beneficiario.
2. Re-crea la cuenta con fondeo desde `nearena.testnet`.
3. Compila el WASM (`gladiator_game`).
4. Hace deploy del contrato.
5. Llama `new(...)`.
6. Ejecuta smoke test (`register_player`, `upsert_item_definition`, `credit_deposit`, `buy_item`, checks de pot/treasury/player).
7. (Nuevo) Crea un jugador secundario Solana->MPC->NEAR:
	- genera keypair Solana devnet,
	- deriva public key Ed25519 por Chain Signatures,
	- la transforma en cuenta implícita de NEAR,
	- fondea esa cuenta implícita,
	- registra `register_player` firmado con `sign-with-mpc`.

### Variables principales

- `NETWORK_NAME` (default `testnet`)
- `SIGNER_ACCOUNT_ID` (default `nearena.testnet`)
- `BENEFICIARY_ACCOUNT_ID` (default `nearena.testnet`)
- `CONTRACT_ACCOUNT_ID` (default `nearena-v1.testnet`)
- `OWNER_ID` (default `SIGNER_ACCOUNT_ID`)
- `RELAYER_ACCOUNT_ID` (default `SIGNER_ACCOUNT_ID`)
- `PLAYER_ACCOUNT_ID` (default `SIGNER_ACCOUNT_ID`)
- `INITIAL_BALANCE_NEAR` (default `3`)
- `ENABLE_SOLANA_MPC_PLAYER` (default `true`)
- `SOLANA_RPC_URL` (default `https://api.devnet.solana.com`)
- `SOLANA_KEYPAIR_PATH` (default `scripts/.tmp/solana-devnet-player.json`)
- `SOLANA_AIRDROP_AMOUNT` (default `1`)
- `IMPLICIT_ACCOUNT_FUNDING_NEAR` (default `0.05 NEAR`)
- `MPC_ADMIN_ACCOUNT_ID` (default `SIGNER_ACCOUNT_ID`)
- `MPC_DERIVATION_PREFIX` (default `solana`)
- `MPC_PUBLIC_KEY_METHOD` (default `derived_public_key`)
- `MPC_SIGN_GAS` (default `120 Tgas`)
- `MPC_SIGN_DEPOSIT` (default `1 yoctonear`)

### Ejecutar

```bash
npm run testnet:reset-deploy-game --workspace @gladiator/scripts
```

Para ejecutar solo el flujo NEAR clásico (sin jugador secundario MPC):

```bash
ENABLE_SOLANA_MPC_PLAYER=false \
npm run testnet:reset-deploy-game --workspace @gladiator/scripts
```

Si querés override de cuenta/owner/relayer/player:

```bash
NETWORK_NAME=testnet \
SIGNER_ACCOUNT_ID=nearena.testnet \
BENEFICIARY_ACCOUNT_ID=nearena.testnet \
CONTRACT_ACCOUNT_ID=nearena-v1.testnet \
OWNER_ID=nearena.testnet \
RELAYER_ACCOUNT_ID=nearena.testnet \
PLAYER_ACCOUNT_ID=nearena.testnet \
npm run testnet:reset-deploy-game --workspace @gladiator/scripts
```
