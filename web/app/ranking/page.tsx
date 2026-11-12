"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CurrencyAmount } from "@/components/currency-amount";
import { formatScaled, type LeaderboardEntry, type TournamentView } from "@/lib/near-rpc";
import { nearQueryOptions } from "@/lib/near-query";
import { TEXTS } from "@/lib/texts";
import { countdownParts, prizeForRank } from "@/lib/tournament";
import { getPlayerAccountId, getWalletSession, subscribeWalletSession, type WalletSession } from "@/lib/wallet-session";

const T = TEXTS.ranking;
const LEADERBOARD_LIMIT = 50;

export default function RankingPage() {
  const [session, setSession] = useState<WalletSession | null>(null);

  useEffect(() => {
    setSession(getWalletSession());
    return subscribeWalletSession(() => setSession(getWalletSession()));
  }, []);

  const selfId = getPlayerAccountId(session);
  const tournament = useQuery(nearQueryOptions.tournament());
  const leaderboard = useQuery(nearQueryOptions.leaderboard(LEADERBOARD_LIMIT, selfId));

  const error = tournament.error ?? leaderboard.error;
  const board = leaderboard.data;
  const podiumSize = tournament.data?.prize_shares_bps.length ?? 0;
  const podium = board?.entries.slice(0, podiumSize) ?? [];
  const rest = board?.entries.slice(podiumSize) ?? [];
  const viewerOutsideList =
    board?.viewer && !board.entries.some((entry) => entry.account_id === board.viewer?.account_id) ? board.viewer : null;

  return (
    <main>
      <section className="panel app-shell">
        <header>
          <p className="eyebrow">{T.eyebrow}</p>
          <h2>{T.title}</h2>
          <p className="muted">{T.subtitle}</p>
        </header>

        {tournament.data ? <TournamentBanner tournament={tournament.data} /> : null}

        {error ? (
          <div className="status" role="alert">
            {T.couldNotLoad} {error.message}
          </div>
        ) : !tournament.data || !board ? (
          <div className="list-block" aria-busy="true">
            {[0, 1, 2, 3, 4].map((index) => (
              <div className="skeleton arena-row-skeleton-small" key={index} />
            ))}
          </div>
        ) : board.total_players === 0 ? (
          <div className="status">{T.noPlayers}</div>
        ) : (
          <>
            <article className="module">
              <h2>{T.podiumHeading}</h2>
              <ol className="ranking-podium">
                {Array.from({ length: podiumSize }, (_, index) => {
                  const entry = podium[index];
                  const prize = prizeForRank(tournament.data, index + 1);
                  return (
                    <li
                      key={index}
                      className={`ranking-podium-place ranking-place-${index + 1}${
                        entry?.account_id === selfId ? " ranking-row-self" : ""
                      }`}
                    >
                      <span className="ranking-rank">{T.place(index + 1)}</span>
                      <span className="ranking-podium-account">
                        {entry ? entry.account_id : <span className="muted">{T.emptyPlace}</span>}
                        {entry?.account_id === selfId ? <span className="chip">{T.you}</span> : null}
                      </span>
                      <span className="ranking-points">{entry ? T.points(formatScaled(entry.points)) : "—"}</span>
                      {prize !== null ? (
                        <span className="ranking-prize" title={T.prize}>
                          <CurrencyAmount value={prize} currency="SC" />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </article>

            {rest.length > 0 ? (
              <article className="module">
                <h2>{T.restHeading}</h2>
                <div className="list-block">
                  {rest.map((entry) => (
                    <RankingRow entry={entry} isSelf={entry.account_id === selfId} key={entry.account_id} />
                  ))}
                </div>
              </article>
            ) : null}

            {selfId ? (
              viewerOutsideList ? (
                <article className="module">
                  <h2>{T.yourPosition}</h2>
                  <RankingRow entry={viewerOutsideList} isSelf />
                </article>
              ) : !board.viewer ? (
                <div className="status">{T.notRanked}</div>
              ) : null
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

function RankingRow({ entry, isSelf }: { entry: LeaderboardEntry; isSelf: boolean }) {
  return (
    <div className={`list-item ranking-row${isSelf ? " ranking-row-self" : ""}`}>
      <span className="ranking-rank">{T.place(entry.rank)}</span>
      <span className="arena-account">{entry.account_id}</span>
      {isSelf ? <span className="chip">{T.you}</span> : null}
      <span className="ranking-points">{T.points(formatScaled(entry.points))}</span>
    </div>
  );
}

function TournamentBanner({ tournament }: { tournament: TournamentView }) {
  // Count down against chain time: offset the local clock by the drift seen at fetch time.
  const [clockOffsetSec] = useState(() => tournament.now_sec - Date.now() / 1000);
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000 + clockOffsetSec);

  useEffect(() => {
    const timer = window.setInterval(() => setNowSec(Date.now() / 1000 + clockOffsetSec), 1000);
    return () => window.clearInterval(timer);
  }, [clockOffsetSec]);

  const ended = tournament.ended || nowSec >= tournament.end_sec;
  const parts = countdownParts(tournament.end_sec - nowSec);

  return (
    <article className="module ranking-banner">
      <div>
        <span className="muted">{ended ? T.ended : T.endsIn}</span>
        <strong className="ranking-countdown">
          {ended
            ? new Date(tournament.end_sec * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
            : T.countdown(parts.days, parts.hours, parts.minutes, parts.seconds)}
        </strong>
      </div>
      <div>
        <span className="muted">{T.prizePool}</span>
        <strong className="ranking-countdown">
          <CurrencyAmount value={tournament.prize_pool} currency="SC" />
        </strong>
      </div>
      {ended ? <p className="status ranking-final">{T.finalNotice}</p> : null}
    </article>
  );
}
