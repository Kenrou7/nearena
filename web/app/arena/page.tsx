import { SessionGate } from "@/components/session-gate";

export default function ArenaPage() {
  return (
    <SessionGate
      title="Centro de Combate"
      description="Conecta una wallet para desbloquear peleas, rounds y recompensas."
    >
      <main>
        <section className="panel app-shell">
          <header>
            <p className="eyebrow">Arena</p>
            <h2>Centro de Combate</h2>
            <p className="muted">Pantalla dedicada para preparar pelea, ejecutar ronda y revisar resultado.</p>
          </header>

          <article className="module">
            <h2>Preview de batalla</h2>
            <div className="status">
              <p className="muted">Modo: Ranked</p>
              <p className="muted">Dificultad: Veteran</p>
              <p className="muted">Recompensa: Pot share</p>
            </div>
            <div className="row">
              <button className="primary">Preparar pelea</button>
              <button>Historial de rondas</button>
            </div>
          </article>
        </section>
      </main>
    </SessionGate>
  );
}
