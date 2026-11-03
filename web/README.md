# Web

Frontend Next.js minimal para registrar jugadores en NEAR testnet.

## Variables

Crear un archivo `.env.local` en esta carpeta con:

```
NEXT_PUBLIC_NEAR_NETWORK_ID=testnet
NEXT_PUBLIC_NEAR_CONTRACT_ID=nearena-v1.testnet
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_BACKEND_URL=http://localhost:8787
```

## Desarrollo

Desde la raiz del monorepo:

```
npm install
npm run start --workspace @gladiator/backend
npm run dev --workspace @gladiator/web
```

Abrir `http://localhost:3000`.
