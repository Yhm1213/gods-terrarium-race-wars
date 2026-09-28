import { describe, it, expect } from 'vitest';

// 导入 7 个数据层模块
import { OrganFlags, OrganFlagNames, ALL_ORGAN_FLAGS_MASK, hasOrganFlag, getOrganFlagNames } from '../../src/data/MutationFlags.js';
import { DomainEvents, isCriticalEvent, CRITICAL_CHANNEL_MASK, CRITICAL_QUEUE_CAPACITY, EPHEMERAL_QUEUE_CAPACITY } from '../../src/data/DomainEvents.js';
import { MAX_FACTIONS, FACTION_STRIDE, FAC_OFFSET_TOTEM_ID, FAC_OFFSET_CIVIC_ID, FAC_OFFSET_TENSION, FAC_OFFSET_POP_COUNT, FAC_OFFSET_FOOD, FAC_OFFSET_ORE, FAC_OFFSET_WAR_COOLDOWN, FAC_OFFSET_FLAGS, FactionFlags, InitialFactions, Factions, createFactionRuntimeBuffer } from '../../src/data/FactionData.js';
import { Biomes, BiomeList, HazardTypes, isBiomeImpassable } from '../../src/data/BiomeData.js';
import { SuperWeapons, SuperWeaponMisfireType, getSuperWeaponByRace } from '../../src/data/SuperWeaponData.js';
import { Races, RaceList, MetabolicTypes, isOrganTaboo } from '../../src/data/RaceData.js';
import { CivicRoutes, Technologies, RulerTraits, TreatyTypes, SuccessionTypes } from '../../src/data/TechCivicData.js';
import { MaterialTypes, FluidTypes, isValidSeed, normalizeSeed, encodeSeed, decodeSeed, extractSeedFromUrl, generateSeedUrl } from '../../src/data/SeedCodec.js';

describe('Data Layer Specifications Test Suite', () => {

  // ================= 1. MutationFlags =================
  describe('1. MutationFlags (OrganFlags)', () => {
    it('should export frozen OrganFlags with 9 orthogonal bitmasks', () => {
      expect(Object.isFrozen(OrganFlags)).toBe(true);
      expect(OrganFlags.HOLY).toBe(1 << 0);
      expect(OrganFlags.FLAME).toBe(1 << 1);
      expect(OrganFlags.GAS).toBe(1 << 2);
      expect(OrganFlags.WING).toBe(1 << 3);
      expect(OrganFlags.FLESH).toBe(1 << 4);
      expect(OrganFlags.MERCURY).toBe(1 << 5);
      expect(OrganFlags.GRANITE).toBe(1 << 6);
      expect(OrganFlags.ELEC).toBe(1 << 7);
      expect(OrganFlags.AQUATIC).toBe(1 << 8);
    });

    it('should correctly evaluate organ flags and names', () => {
      const combo = OrganFlags.WING | OrganFlags.AQUATIC;
      expect(hasOrganFlag(combo, OrganFlags.WING)).toBe(true);
      expect(hasOrganFlag(combo, OrganFlags.AQUATIC)).toBe(true);
      expect(hasOrganFlag(combo, OrganFlags.HOLY)).toBe(false);

      const names = getOrganFlagNames(combo);
      expect(names).toContain('薄翼');
      expect(names).toContain('水栖');
      expect(names).not.toContain('烈焰');
    });
  });

  // ================= 2. DomainEvents =================
  describe('2. DomainEvents (TDS 5.2)', () => {
    it('should export frozen DomainEvents dictionary', () => {
      expect(Object.isFrozen(DomainEvents)).toBe(true);
    });

    it('should strictly follow TDS 5.2 Critical Transaction Channel (0x8000+)', () => {
      const criticalKeys = [
        'EVT_FACTION_SCHISM',
        'EVT_FACTION_DESTROYED',
        'EVT_HEIR_CROWNED',
        'EVT_WAR_DECLARED',
        'EVT_PAX_DIVINA_FORCED',
        'EVT_PHYLACTERY_SHATTERED',
        'EVT_GOLEM_PETRIFIED',
        'EVT_RULER_DIED',
        'EVT_PEACE_TREATY_SIGNED',
        'EVT_GRUDGE_SETTLED',
        'EVT_OVERDRIVE_STARTED',
        'EVT_OVERDRIVE_ENDED',
        'EVT_SUPER_WEAPON_MISFIRE'
      ];

      for (const key of criticalKeys) {
        const val = DomainEvents[key];
        expect(val).toBeDefined();
        expect((val & 0x8000) !== 0).toBe(true);
        expect(isCriticalEvent(val)).toBe(true);
      }

      expect(DomainEvents.EVT_FACTION_SCHISM).toBe(0x8001);
      expect(DomainEvents.EVT_FACTION_DESTROYED).toBe(0x8002);
      expect(DomainEvents.EVT_HEIR_CROWNED).toBe(0x8003);
      expect(DomainEvents.EVT_WAR_DECLARED).toBe(0x8004);
      expect(DomainEvents.EVT_PAX_DIVINA_FORCED).toBe(0x8005);
      expect(DomainEvents.EVT_PHYLACTERY_SHATTERED).toBe(0x8006);
      expect(DomainEvents.EVT_GOLEM_PETRIFIED).toBe(0x8007);
      expect(DomainEvents.EVT_RULER_DIED).toBe(0x8009);
      expect(DomainEvents.EVT_PEACE_TREATY_SIGNED).toBe(0x800A);
      expect(DomainEvents.EVT_GRUDGE_SETTLED).toBe(0x800B);
      expect(DomainEvents.EVT_OVERDRIVE_STARTED).toBe(0x800C);
      expect(DomainEvents.EVT_OVERDRIVE_ENDED).toBe(0x800D);
      expect(DomainEvents.EVT_SUPER_WEAPON_MISFIRE).toBe(0x800E);
    });

    it('should strictly follow TDS 5.2 Ephemeral Channel (0x0001+)', () => {
      const ephemeralKeys = [
        'EVT_DAMAGE_APPLIED',
        'EVT_ENTITY_SLAIN',
        'EVT_ORGAN_MUTATED',
        'EVT_JOB_AWAKENED',
        'EVT_SUPER_WEAPON_FIRED',
        'EVT_ELEMENT_EXPLODED',
        'EVT_MIRACLE_ACTIVATED',
        'EVT_AIRBORNE_LANDED',
        'EVT_GRUDGE_RECORDED',
        'EVT_CORPSE_DEGRADED'
      ];

      for (const key of ephemeralKeys) {
        const val = DomainEvents[key];
        expect(val).toBeDefined();
        expect((val & 0x8000) === 0).toBe(true);
        expect(isCriticalEvent(val)).toBe(false);
      }

      expect(DomainEvents.EVT_DAMAGE_APPLIED).toBe(0x0001);
      expect(DomainEvents.EVT_ENTITY_SLAIN).toBe(0x0002);
      expect(DomainEvents.EVT_CORPSE_DEGRADED).toBe(0x000A);
    });

    it('should have standard queue capacities', () => {
      expect(CRITICAL_QUEUE_CAPACITY).toBe(512);
      expect(EPHEMERAL_QUEUE_CAPACITY).toBe(3584);
    });
  });

  // ================= 3. FactionData =================
  describe('3. FactionData', () => {
    it('should export MAX_FACTIONS = 16, FACTION_STRIDE = 8 and offsets', () => {
      expect(MAX_FACTIONS).toBe(16);
      expect(FACTION_STRIDE).toBe(8);
      expect(FAC_OFFSET_TOTEM_ID).toBe(0);
      expect(FAC_OFFSET_CIVIC_ID).toBe(1);
      expect(FAC_OFFSET_TENSION).toBe(2);
      expect(FAC_OFFSET_POP_COUNT).toBe(3);
      expect(FAC_OFFSET_FOOD).toBe(4);
      expect(FAC_OFFSET_ORE).toBe(5);
      expect(FAC_OFFSET_WAR_COOLDOWN).toBe(6);
      expect(FAC_OFFSET_FLAGS).toBe(7);
    });

    it('should provide 16 initial factions configuration', () => {
      expect(InitialFactions).toHaveLength(16);
      expect(Object.isFrozen(InitialFactions)).toBe(true);

      for (let i = 0; i < 16; i++) {
        const fac = InitialFactions[i];
        expect(fac.id).toBe(i);
        expect(typeof fac.key).toBe('string');
        expect(typeof fac.name).toBe('string');
        expect(typeof fac.primaryColor).toBe('string');
        expect(Object.isFrozen(fac)).toBe(true);
      }

      expect(Factions['HUMAN_EMPIRE']).toBeDefined();
      expect(Factions['ORC_HORDE']).toBeDefined();
      expect(Factions['DWARF_CLAN']).toBeDefined();
    });

    it('should correctly allocate and populate FactionRuntimeBuffer', () => {
      const buffer = createFactionRuntimeBuffer();
      expect(buffer).toBeInstanceOf(Int32Array);
      expect(buffer.length).toBe(MAX_FACTIONS * FACTION_STRIDE); // 128 elements

      // 验证人类阵营初始数据
      const humanOffset = 2 * FACTION_STRIDE;
      expect(buffer[humanOffset + FAC_OFFSET_CIVIC_ID]).toBe(0); // 世袭皇权
      expect(buffer[humanOffset + FAC_OFFSET_FOOD]).toBe(150);
      expect(buffer[humanOffset + FAC_OFFSET_FLAGS]).toBe(FactionFlags.ACTIVE);
    });
  });

  // ================= 4. BiomeData =================
  describe('4. BiomeData', () => {
    it('should export frozen Biomes with nutrientFloor in [0.0, 1.0]', () => {
      expect(Object.isFrozen(Biomes)).toBe(true);
      expect(BiomeList.length).toBeGreaterThanOrEqual(6);

      for (const biome of Object.values(Biomes)) {
        expect(biome.nutrientFloor).toBeGreaterThanOrEqual(0.0);
        expect(biome.nutrientFloor).toBeLessThanOrEqual(1.0);
        expect(biome.moveCostMultiplier).toBeGreaterThan(0);
        expect(typeof biome.colorCode).toBe('string');
        expect(Object.isFrozen(biome)).toBe(true);
      }
    });

    it('should correctly identify impassable deep water', () => {
      expect(Biomes.DEEP_WATER.moveCostMultiplier).toBe(999.0);
      expect(isBiomeImpassable(Biomes.DEEP_WATER.id)).toBe(true);
      expect(isBiomeImpassable(Biomes.PLAINS.id)).toBe(false);
    });

    it('should match TDS 2.3 values for Plains and Holy Spring', () => {
      expect(Biomes.PLAINS.nutrientFloor).toBe(0.25);
      expect(Biomes.HOLY_SPRING.nutrientFloor).toBe(0.85);
      expect(Biomes.SWAMP.hazardType).toBe(HazardTypes.ACID);
      expect(Biomes.VOLCANO.hazardType).toBe(HazardTypes.FIRE);
    });
  });

  // ================= 5. SuperWeaponData =================
  describe('5. SuperWeaponData', () => {
    it('should export 4 super weapons with complete combat parameters', () => {
      expect(Object.isFrozen(SuperWeapons)).toBe(true);
      const keys = ['DWARF_CANNON', 'GOBLIN_AIRSHIP', 'ORC_BEHEMOTH', 'ELF_ANCIENT_TREANT'];
      for (const k of keys) {
        expect(SuperWeapons[k]).toBeDefined();
        expect(Object.isFrozen(SuperWeapons[k])).toBe(true);
      }

      // 矮人轨道巨炮
      const cannon = SuperWeapons.DWARF_CANNON;
      expect(cannon.maxRange).toBe(14);
      expect(cannon.damage).toBe(280);
      expect(cannon.misfireRate).toBe(0.10);
      expect(cannon.misfireEffect.selfDamage).toBe(80);

      // 地精飞艇
      const airship = SuperWeapons.GOBLIN_AIRSHIP;
      expect(airship.maxHp).toBe(180);
      expect(airship.misfireRate).toBe(0.25);
      expect(airship.misfireEffect.selfExplodeInBase).toBe(true);

      // 比蒙巨兽
      const behemoth = SuperWeapons.ORC_BEHEMOTH;
      expect(behemoth.maxHp).toBe(1200);
      expect(behemoth.mass).toBe(550.0);
      expect(behemoth.dailyMeatUpkeep).toBe(5);

      // 远古树精
      const treant = SuperWeapons.ELF_ANCIENT_TREANT;
      expect(treant.maxHp).toBe(950);
      expect(treant.mass).toBe(420.0);
      expect(treant.entangle.slowPct).toBe(0.60);
      expect(treant.firePanicDurationSec).toBe(8.0);
    });

    it('should find super weapon by race', () => {
      expect(getSuperWeaponByRace('DWARF')?.name).toBe('地鸣破城轨道巨炮');
      expect(getSuperWeaponByRace('UNKNOWN')).toBeNull();
    });
  });

  // ================= 6. RaceData =================
  describe('6. RaceData', () => {
    it('should export frozen Races with 12 balanced races', () => {
      expect(Object.isFrozen(Races)).toBe(true);
      expect(RaceList).toHaveLength(12);

      const requiredRaces = [
        'ORC', 'ELF', 'HUMAN', 'DWARF', 'UNDEAD', 'GOBLIN',
        'DEMON', 'LIZARD', 'BEAST', 'SPORE', 'GOLEM', 'ABERR'
      ];

      for (const rid of requiredRaces) {
        const race = Races[rid];
        expect(race).toBeDefined();
        expect(race.id).toBe(rid);
        expect(race.mass).toBeGreaterThan(0);
        expect(race.baseSpeed).toBeGreaterThan(0);
        expect(race.baseHp).toBeGreaterThan(0);
        expect(typeof race.tabooMask).toBe('number');
        expect(race.resistances).toBeDefined();
        expect(Object.isFrozen(race)).toBe(true);
      }
    });

    it('should verify bug fixes and numerical balance in TDS 2.1', () => {
      // 恶魔削弱至 130 HP
      expect(Races.DEMON.baseHp).toBe(130);
      expect(Races.DEMON.resistances.fire).toBe(0.50);

      // 魔像修正至 180 HP 与 180kg
      expect(Races.GOLEM.baseHp).toBe(180);
      expect(Races.GOLEM.mass).toBe(180.0);

      // 挽救真菌人至 95 HP
      expect(Races.SPORE.baseHp).toBe(95);

      // 魔眼消除饥饿死锁
      expect(Races.ABERR.metabolicRate).toBe(0.0);

      // 亡灵禁忌圣灵与鲜肉
      expect(isOrganTaboo('UNDEAD', OrganFlags.HOLY)).toBe(true);
      expect(isOrganTaboo('UNDEAD', OrganFlags.FLESH)).toBe(true);
      expect(isOrganTaboo('UNDEAD', OrganFlags.FLAME)).toBe(false);

      // 人类无禁忌
      expect(isOrganTaboo('HUMAN', OrganFlags.HOLY | OrganFlags.FLESH)).toBe(false);
    });
  });

  // ================= 7. TechCivicData =================
  describe('7. TechCivicData', () => {
    it('should export 4 Civic routes with correct modifiers', () => {
      expect(Object.isFrozen(CivicRoutes)).toBe(true);
      expect(CivicRoutes.HEREDITARY_DYNASTY.modifiers.stabilityBonus).toBe(0.40);
      expect(CivicRoutes.MILITARY_AUTOCRACY.modifiers.attackPowerBonus).toBe(0.25);
      expect(CivicRoutes.ELDERS_COUNCIL.modifiers.researchSpeedBonus).toBe(0.50);
      expect(CivicRoutes.THEOCRATIC_ORTHODOXY.modifiers.faithYieldBonus).toBe(1.00);
    });

    it('should export 3-tier Technologies', () => {
      expect(Object.isFrozen(Technologies)).toBe(true);
      expect(Technologies.TECH_AGRICULTURE.tier).toBe(1);
      expect(Technologies.TECH_SHIELD_WALL.tier).toBe(2);
      expect(Technologies.TECH_SUPER_WEAPON.tier).toBe(3);
    });

    it('should export 6 RulerTraits with tension bias', () => {
      expect(Object.isFrozen(RulerTraits)).toBe(true);
      expect(RulerTraits.TYRANT.name).toBe('残暴暴君');
      expect(RulerTraits.TYRANT.tensionBias[CivicRoutes.ELDERS_COUNCIL.id]).toBeGreaterThan(0.5);
    });

    it('should export TreatyTypes and SuccessionTypes', () => {
      expect(TreatyTypes.ENSLAVE).toBe(0);
      expect(TreatyTypes.ALLIANCE).toBe(1);
      expect(SuccessionTypes.NORMAL_SUCCESSION).toBe(0);
      expect(SuccessionTypes.ACCIDENTAL_DEATH).toBe(1);
    });
  });

  // ================= 8. SeedCodec =================
  describe('8. SeedCodec', () => {
    it('should validate and normalize 16-hex seeds', () => {
      expect(isValidSeed('E8A2-F04C-99B1-D330')).toBe(true);
      expect(isValidSeed('#E8A2-F04C-99B1-D330')).toBe(true);
      expect(isValidSeed('E8A2F04C99B1D330')).toBe(true);
      expect(isValidSeed('invalid-seed-format')).toBe(false);

      expect(normalizeSeed('#e8a2-f04c-99b1-d330')).toBe('E8A2-F04C-99B1-D330');
    });

    it('should guarantee 100% reversible encoding and decoding (DoD Assert)', () => {
      const originalTraits = {
        raceId: 'DWARF',
        mass: 1.80,
        speedMultiplier: 0.85,
        materialType: MaterialTypes.GRANITE,
        fluidType: FluidTypes.LAVA,
        armorBonus: 8,
        metabolicType: MetabolicTypes.HUNTER,
        organMask: OrganFlags.GRANITE | OrganFlags.FLAME,
        skillIndex: 0x1234
      };

      const seedStr = encodeSeed(originalTraits);
      expect(isValidSeed(seedStr)).toBe(true);

      const decoded = decodeSeed(seedStr);
      expect(decoded.raceId).toBe('DWARF');
      expect(Math.abs(decoded.mass - originalTraits.mass)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(decoded.speedMultiplier - originalTraits.speedMultiplier)).toBeLessThanOrEqual(0.025);
      expect(decoded.materialType).toBe(MaterialTypes.GRANITE);
      expect(decoded.fluidType).toBe(FluidTypes.LAVA);
      expect(decoded.armorBonus).toBe(originalTraits.armorBonus);
      expect(decoded.metabolicType).toBe(MetabolicTypes.HUNTER);
      expect(decoded.organMask).toBe(originalTraits.organMask);
      expect(decoded.skillIndex).toBe(originalTraits.skillIndex);
    });

    it('should extract seed from URL query or generate shareable URL (REQ-NAR-005)', () => {
      const url = 'http://localhost:3000/index.html?seed=E8A2-F04C-99B1-D330&zoom=1.2';
      const extracted = extractSeedFromUrl(url);
      expect(extracted).toBe('E8A2-F04C-99B1-D330');

      const generated = generateSeedUrl('http://localhost:3000/index.html', 'a1b2-c3d4-e5f6-0789');
      expect(generated).toBe('http://localhost:3000/index.html?seed=A1B2-C3D4-E5F6-0789');
    });
  });

});
