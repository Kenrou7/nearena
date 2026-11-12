//! PvE creatures as data. Adding a creature means adding one entry to `CREATURES`:
//! no special-case code. A creature always matches the level of the player facing it.

/// Fixed-point scale shared with the game contract (1.0 == 1_000_000).
const SCALE: u128 = 1_000_000;

pub struct CreatureReward {
    /// Game coins credited to the player (scaled).
    pub game_coins: u128,
    /// Experience credited to the player (scaled).
    pub xp: u128,
}

pub struct CreatureDrop {
    /// Item from the catalog minted to the player.
    pub item_id: &'static str,
    /// Chance per victory in basis points (10_000 == 100%). At most one drop per fight.
    pub chance_bps: u16,
}

pub struct CreatureDefinition {
    pub id: &'static str,
    pub name: &'static str,
    /// Starting stats before level points (scaled).
    pub base_strength: u128,
    pub base_dexterity: u128,
    pub base_vitality: u128,
    /// Stat points spread at random over STR/DEX/VIT for each level, level 1 included.
    pub points_per_level: u32,
    pub win: CreatureReward,
    pub loss: CreatureReward,
    pub draw: CreatureReward,
    /// Rolled only on victory; cumulative chances must not exceed 10_000 bps.
    pub drops: &'static [CreatureDrop],
}

pub const CREATURES: &[CreatureDefinition] = &[CreatureDefinition {
    id: "wolf",
    name: "Wolf",
    base_strength: 4 * SCALE,
    base_dexterity: 4 * SCALE,
    base_vitality: 4 * SCALE,
    points_per_level: 3,
    win: CreatureReward {
        game_coins: 10 * SCALE,
        xp: 20 * SCALE,
    },
    loss: CreatureReward {
        game_coins: 0,
        xp: 10 * SCALE,
    },
    draw: CreatureReward {
        game_coins: 0,
        xp: 10 * SCALE,
    },
    drops: &[
        CreatureDrop {
            item_id: "potion_small",
            chance_bps: 1_500,
        },
        CreatureDrop {
            item_id: "potion_medium",
            chance_bps: 400,
        },
        CreatureDrop {
            item_id: "potion_large",
            chance_bps: 100,
        },
    ],
}];

pub fn find_creature(creature_id: &str) -> Option<&'static CreatureDefinition> {
    CREATURES.iter().find(|creature| creature.id == creature_id)
}

/// Picks the drop for a victory roll in `1..=10_000`: drops occupy consecutive ranges of
/// their chance, so a single roll yields at most one item.
pub fn drop_for_roll(
    drops: &'static [CreatureDrop],
    roll_bps: u16,
) -> Option<&'static CreatureDrop> {
    let mut upper: u32 = 0;
    for drop in drops {
        upper += u32::from(drop.chance_bps);
        if u32::from(roll_bps) <= upper {
            return Some(drop);
        }
    }
    None
}
