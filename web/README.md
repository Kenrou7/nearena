# Web

Frontend Next.js minimal para registrar jugadores en NEAR testnet.

## Variables

Crear un archivo `.env.local` en esta carpeta con:

```
NEXT_PUBLIC_NEAR_NETWORK_ID=testnet
NEXT_PUBLIC_NEAR_CONTRACT_ID=nearena-v1.testnet
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_BACKEND_URL=http://localhost:8787

# Server-side RPC upstreams used by /api/near-rpc (comma-separated fallback list)
NEAR_RPC_URLS=https://near-testnet.drpc.org,https://test.rpc.fastnear.com,https://archival-rpc.testnet.near.org
```

## Flujo RPC recomendado

- Lecturas (`view` calls): pasan por `/api/near-rpc` (backend proxy).
- Escrituras (transacciones): las firma y envía la wallet del usuario en frontend.
- Si tienes una URL privada de dRPC, ponla primero en `NEAR_RPC_URLS`.

## Desarrollo

Desde la raiz del monorepo:

```
npm install
npm run start --workspace @gladiator/backend
npm run dev --workspace @gladiator/web
```

Abrir `http://localhost:3000`.
