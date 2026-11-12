import { infiniteQueryOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  type CombatRole,
  getArenaView,
  getCombatHistory,
  getChallengeCandidates,
  getItemDefinitionView,
  getPlayerView,
  getTierTop,
  getTokenView,
  replayCombat,
} from "@/lib/near-rpc";

export const COMBAT_HISTORY_PAGE_SIZE = 10;

export const nearQueryKeys = {
  root: ["near"] as const,
  player: (accountId: string) => ["near", "player", accountId] as const,
  arena: (accountId: string) => ["near", "arena", accountId] as const,
  candidates: (accountId: string) => ["near", "candidates", accountId] as const,
  tierTop: (tier: number, limit: number) => ["near", "tierTop", tier, limit] as const,
  itemDefinition: (itemId: string) => ["near", "itemDefinition", itemId] as const,
  token: (tokenId: string) => ["near", "token", tokenId] as const,
  combatHistory: (accountId: string, role: CombatRole) => ["near", "combatHistory", accountId, role] as const,
  combatReplay: (combatId: number) => ["near", "combatReplay", combatId] as const,
};

export const nearQueryOptions = {
  player: (accountId: string) =>
    queryOptions({
      queryKey: nearQueryKeys.player(accountId),
      queryFn: () => getPlayerView(accountId),
      staleTime: 8_000,
    }),
  arena: (accountId: string) =>
    queryOptions({
      queryKey: nearQueryKeys.arena(accountId),
      queryFn: () => getArenaView(accountId),
      staleTime: 5_000,
    }),
  candidates: (accountId: string) =>
    queryOptions({
      queryKey: nearQueryKeys.candidates(accountId),
      queryFn: () => getChallengeCandidates(accountId),
      staleTime: 5_000,
    }),
  tierTop: (tier: number, limit: number) =>
    queryOptions({
      queryKey: nearQueryKeys.tierTop(tier, limit),
      queryFn: () => getTierTop(tier, limit),
      staleTime: 5_000,
    }),
  itemDefinition: (itemId: string) =>
    queryOptions({
      queryKey: nearQueryKeys.itemDefinition(itemId),
      queryFn: () => getItemDefinitionView(itemId),
      staleTime: 5 * 60_000,
    }),
  token: (tokenId: string) =>
    queryOptions({
      queryKey: nearQueryKeys.token(tokenId),
      queryFn: () => getTokenView(tokenId),
      staleTime: 10_000,
    }),
  combatHistory: (accountId: string, role: CombatRole) =>
    infiniteQueryOptions({
      queryKey: nearQueryKeys.combatHistory(accountId, role),
      queryFn: ({ pageParam }) => getCombatHistory(accountId, role, pageParam, COMBAT_HISTORY_PAGE_SIZE),
      initialPageParam: 0,
      getNextPageParam: (lastPage, pages) => {
        const loaded = pages.reduce((count, page) => count + page.items.length, 0);
        return lastPage.items.length > 0 && loaded < lastPage.total ? loaded : undefined;
      },
      staleTime: 10_000,
    }),
  /** A stored combat never changes, so its replay is cached for good. */
  combatReplay: (combatId: number) =>
    queryOptions({
      queryKey: nearQueryKeys.combatReplay(combatId),
      queryFn: () => replayCombat(combatId),
      staleTime: Number.POSITIVE_INFINITY,
    }),
};

export async function invalidateNearQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: nearQueryKeys.root });
}
