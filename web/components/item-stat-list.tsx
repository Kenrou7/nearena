import { buildItemStatMetrics } from "@/lib/item-stats";
import { formatScaled, type ItemDefinitionView } from "@/lib/near-rpc";

type ItemStatListProps = {
  definition: ItemDefinitionView | null;
  itemTitle: string;
};

/**
 * Shared stat bars for item cards (shop, inventory): only stats the item actually
 * grants are shown, and consumables show their healing as HP instead of VIT.
 */
export function ItemStatList({ definition, itemTitle }: ItemStatListProps) {
  const metrics = buildItemStatMetrics(definition);
  if (metrics.length === 0) {
    return null;
  }

  const percentMetrics = metrics.filter((metric) => metric.percentBps > 0);

  return (
    <div className="item-stat-grid" aria-label={`Item stats for ${itemTitle}`}>
      {metrics
        .filter((metric) => metric.flatBonus > 0n)
        .map((metric) => (
          <div className="item-stat-row" key={metric.key}>
            <span className="item-stat-label">{metric.label}</span>
            <div className="item-stat-track" role="presentation">
              <div
                className={`item-stat-fill item-stat-fill-${metric.fillClass}`}
                style={{ width: `${metric.fillWidth}%` }}
              />
            </div>
            <span className="item-stat-value">+{formatScaled(metric.flatBonus.toString())}</span>
          </div>
        ))}
      {percentMetrics.length > 0 ? (
        <div className="item-percent-bonuses">
          <span>Percent bonuses:</span>
          {percentMetrics.map((metric) => (
            <span className="chip" key={`${metric.key}:pct`}>
              {metric.label} {(metric.percentBps / 100).toFixed(2)}%
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
