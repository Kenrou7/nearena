# Web

Frontend Next.js minimal para registrar jugadores en NEAR testnet.

## Variables

Copiar `.env.example` a `.env.local` en esta carpeta y ajustar valores:

```
NEXT_PUBLIC_NEAR_NETWORK_ID=testnet
NEXT_PUBLIC_NEAR_CONTRACT_ID=nearena-v1.testnet
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_BACKEND_URL=http://localhost:8787
NEXT_PUBLIC_NEAR_RPC_PROXY_PATH=http://localhost:8787/v1/near-rpc

# Server-side RPC upstreams used by /api/near-rpc (comma-separated fallback list)
NEAR_RPC_URLS=https://near-testnet.drpc.org,https://test.rpc.fastnear.com,https://archival-rpc.testnet.near.org
```

## Flujo RPC recomendado

- Lecturas (`view` calls): pasan por `NEXT_PUBLIC_NEAR_RPC_PROXY_PATH`.
- Escrituras (transacciones): las firma y envía la wallet del usuario en frontend.
- Si tienes una URL privada de dRPC, ponla primero en `NEAR_RPC_URLS`.

## Produccion con GitHub Pages + backend separado

En el workflow de `gh-pages`, define estas Repository Variables:

- `NEXT_PUBLIC_BACKEND_URL=https://api.tu-dominio.com`
- `NEXT_PUBLIC_NEAR_RPC_PROXY_PATH=https://api.tu-dominio.com/v1/near-rpc`
- `NEXT_PUBLIC_NEAR_CONTRACT_ID=nearena-v1.testnet`
- `NEXT_PUBLIC_NEAR_NETWORK_ID=testnet`

Y en el backend define `BACKEND_CORS_ALLOWED_ORIGINS` con la URL de tu Pages, por ejemplo:

- `BACKEND_CORS_ALLOWED_ORIGINS=https://<user>.github.io`

## Desarrollo

Desde la raiz del monorepo:

```
npm install
npm run start --workspace @gladiator/backend
npm run dev --workspace @gladiator/web
```

Abrir `http://localhost:3000`.
