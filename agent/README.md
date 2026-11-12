# Agent: bot de Gladiator con NEAR AI

Bot autónomo que juega Gladiator en NEAR testnet. Decide con un modelo de **NEAR AI Cloud** y juega con la misma API pública que cualquier jugador: no tiene privilegios ni atajos.

## Qué es NEAR AI (en 30 segundos)

**NEAR AI Cloud** es una API de modelos de lenguaje (GLM, Qwen, GPT-OSS, entre otros) que corre dentro de *Trusted Execution Environments*, lo que hace que la inferencia sea privada y verificable. Es **compatible con OpenAI**: el SDK `openai` funciona tal cual cambiando dos líneas.

```ts
const client = new OpenAI({ baseURL: "https://cloud-api.near.ai/v1", apiKey: process.env.NEAR_AI_API_KEY });
```

El "agente" no es un servicio mágico. Es un loop: **observar → decidir → actuar**.

```
           ┌──────────────── vistas del contrato game ────────────────┐
           │  get_player_view · get_arena_view · get_challenge_candidates │
           ▼  get_creatures · get_item_definition · get_token            │
   ┌──────────────┐  estado + tools   ┌──────────────────┐               │
   │ game-state.ts │ ───────────────▶ │  NEAR AI Cloud   │  (brain.ts)   │
   └──────────────┘                   │  function calling │               │
                                      └────────┬─────────┘               │
                                    tool call  ▼                          │
                                      ┌──────────────────┐  inválida → reintento
                                      │  validator.ts     │  → fallback.ts (reglas)
                                      └────────┬─────────┘               │
                                    válida     ▼                          │
                                      ┌──────────────────┐   tx firmada   │
                                      │  near-client.ts   │ ──────────────┘
                                      └──────────────────┘   (cuenta del bot)
```

Las **tools** que ve el modelo se corresponden 1 a 1 con métodos públicos del contrato (`tools.ts`): `register_player`, `assign_stat_points`, `buy_item`, `equip`, `consume`, `start_expedition`, `challenge`, `claim_leader_income` y `wait`. Cada tool call incluye un `reason`, que queda en el log.

## Crear tu bot en 5 pasos

1. **Cuenta del bot en testnet.** El bot es un jugador más.
   ```bash
   near account create-account sponsor-by-faucet-service gladiator-bot.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
   cat ~/.near-credentials/testnet/gladiator-bot.testnet.json   # private_key → BOT_PRIVATE_KEY
   ```
2. **API key de NEAR AI.** Entrar a <https://cloud.near.ai>, cargar créditos en *Credits* y crear una key en *API Keys*.
3. **Elegir un modelo con tools.** Listar los modelos disponibles y quedarse con uno que soporte function calling:
   ```bash
   curl -s https://cloud-api.near.ai/v1/models -H "Authorization: Bearer $NEAR_AI_API_KEY"
   ```
4. **Configurar.** Ejecutar `cp agent/.env.example agent/.env` y completar `NEAR_AI_API_KEY`, `BOT_ACCOUNT_ID` y `BOT_PRIVATE_KEY`.
5. **Jugar:**
   ```bash
   npm run start -w agent -- --dry-run --turns 3   # lee el estado y decide, pero no firma
   npm run start -w agent -- --turns 10            # juega de verdad
   npm run start -w agent -- --no-llm              # solo reglas, sin NEAR AI
   ```

Ejemplo de log:

```
bot gladiator-bot.testnet | brain: NEAR AI (zai-org/GLM-5.1-FP8) | dry-run: false
[turn 3] state: lvl 2 | hp 96/120 | coins 40 | points 0 | rank 6 tier 1
[turn 3] NEAR AI → challenge(opponent_account_id=g01-03.testnet) — lowest level rival above me
[turn 3]   WON vs g01-03.testnet in 6 rounds (combat #42) | tx 8xQ…
```

Las peleas del bot aparecen en `/ranking` y en el historial de la arena de la web, igual que las de cualquier jugador.

## Seguridad y robustez

- **Validador** (`validator.ts`): rechaza antes de firmar cualquier acción que el contrato fallaría (puntos de más, rival fuera de los candidatos, HP < 20%, coins insuficientes, token ajeno, etc.). El motivo vuelve al modelo y tiene un reintento.
- **Fallback** (`fallback.ts`): una estrategia determinista para cuando el LLM falla dos veces, la API no responde o se usa `--no-llm`.
- **Allowlist de métodos** (`ALLOWED_METHODS`): el bot nunca llama métodos del owner, `dev_*` ni `credit_deposit`.
- Se detiene después de 3 transacciones fallidas seguidas.

## Variables de entorno

Ver [.env.example](.env.example). Solo son obligatorias `NEAR_AI_API_KEY` (salvo con `--no-llm`), `GAME_CONTRACT_ID`, `BOT_ACCOUNT_ID` y `BOT_PRIVATE_KEY` (salvo con `--dry-run`). Si falta alguna, el bot falla al arrancar.

## Tests

```bash
npm run lint -w agent
npm test -w agent            # unit tests + smoke test con LLM y chain mockeados
npm run test:coverage -w agent
```
