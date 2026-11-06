export default function RankingPage() {
  return (
    <main>
      <section className="panel app-shell">
        <header>
          <p className="eyebrow">Ranking</p>
          <h2>Leaderboard</h2>
          <p className="muted">Pantalla dedicada para clasificacion y filtros competitivos.</p>
        </header>

        <article className="module">
          <h2>Top Arena</h2>
          <div className="list-block">
            <div className="list-item"><span>#1 Aurelius Vex</span><span className="chip">ELO 1620</span></div>
            <div className="list-item"><span>#2 Karra Flint</span><span className="chip">ELO 1578</span></div>
            <div className="list-item"><span>#3 Morrow Dane</span><span className="chip">ELO 1539</span></div>
          </div>
        </article>
      </section>
    </main>
  );
}
