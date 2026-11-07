import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  getArenaView,
  getChallengeCandidates,
  getItemDefinitionView,
  getPlayerView,
  getTierTop,
  getTokenView,
} from "@/lib/near-rpc";

export const nearQueryKeys = {
  root: ["near"] as const,
  player: (accountId: string) => ["near", "player", accountId] as const,
  arena: (accountId: string) => ["near", "arena", accountId] as const,
  candidates: (accountId: string) => ["near", "candidates", accountId] as const,
  tierTop: (tier: number, limit: number) => ["near", "tierTop", tier, limit] as const,
  itemDefinition: (itemId: string) => ["near", "itemDefinition", itemId] as const,
  token: (tokenId: string) => ["near", "token", tokenId] as const,
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
};

export async function invalidateNearQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: nearQueryKeys.root });
}
