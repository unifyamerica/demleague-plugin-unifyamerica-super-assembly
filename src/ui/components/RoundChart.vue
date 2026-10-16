<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../plugin';

interface ChartRound {
  round: number;
  average: number | null;
  min: number | null;
  max: number | null;
  mine?: number | null;
}

// Each round's range (min to max), the group's average and, for a participant, their own answer
const props = defineProps<{ rounds: ChartRound[]; min: number; max: number }>();
const { t } = useI18n();

const WIDTH = 360;
const HEIGHT = 200;
const TOP = 16;
const BOTTOM = 172;
const LEFT = 48;

const columnX = (index: number) =>
  LEFT +
  ((index + 0.5) * (WIDTH - LEFT - 8)) / Math.max(props.rounds.length, 1);
const y = (value: number) => {
  const span = props.max - props.min || 1;
  return BOTTOM - ((value - props.min) / span) * (BOTTOM - TOP);
};

const ticks = computed(() => [
  props.max,
  Math.round((props.max + props.min) / 2),
  props.min,
]);
const minePoints = computed(() =>
  props.rounds
    .map((round, i) =>
      round.mine === null || round.mine === undefined
        ? null
        : `${columnX(i)},${y(round.mine)}`,
    )
    .filter((point): point is string => point !== null)
    .join(' '),
);
const showsMine = computed(() =>
  props.rounds.some((r) => r.mine !== null && r.mine !== undefined),
);
</script>

<template>
  <figure class="flex flex-col gap-2">
    <svg
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      class="w-full max-w-md"
      role="img"
      :aria-label="t('chart.label')"
    >
      <g v-for="tick in ticks" :key="tick">
        <line
          :x1="LEFT"
          :x2="WIDTH - 8"
          :y1="y(tick)"
          :y2="y(tick)"
          class="stroke-surface-200"
        />
        <text
          :x="LEFT - 8"
          :y="y(tick) + 4"
          text-anchor="end"
          class="fill-surface-500 text-xs"
        >
          {{ tick }}
        </text>
      </g>
      <g v-for="(round, i) in rounds" :key="round.round">
        <rect
          v-if="round.min !== null && round.max !== null"
          :x="columnX(i) - 14"
          :y="y(round.max) - 2"
          width="28"
          :height="Math.max(y(round.min) - y(round.max) + 4, 4)"
          rx="4"
          class="fill-primary-100"
        />
        <line
          v-if="round.average !== null"
          :x1="columnX(i) - 18"
          :x2="columnX(i) + 18"
          :y1="y(round.average)"
          :y2="y(round.average)"
          class="stroke-primary-600"
          stroke-width="3"
        />
        <text
          :x="columnX(i)"
          :y="HEIGHT - 6"
          text-anchor="middle"
          class="fill-surface-500 text-xs"
        >
          {{ t('chart.round', { round: round.round }) }}
        </text>
      </g>
      <polyline
        v-if="showsMine"
        :points="minePoints"
        fill="none"
        class="stroke-orange-500"
        stroke-width="2"
      />
      <template v-for="(round, i) in rounds" :key="`mine-${round.round}`">
        <circle
          v-if="round.mine !== null && round.mine !== undefined"
          :cx="columnX(i)"
          :cy="y(round.mine)"
          r="5"
          class="fill-orange-500"
        />
      </template>
    </svg>
    <figcaption class="flex flex-wrap gap-4 text-sm text-surface-600">
      <span class="flex items-center gap-2">
        <span class="inline-block h-1 w-4 rounded bg-primary-600" />{{
          t('chart.average')
        }}
      </span>
      <span class="flex items-center gap-2">
        <span class="inline-block h-3 w-4 rounded bg-primary-100" />{{
          t('chart.range')
        }}
      </span>
      <span v-if="showsMine" class="flex items-center gap-2">
        <span class="inline-block h-3 w-3 rounded-full bg-orange-500" />{{
          t('chart.mine')
        }}
      </span>
    </figcaption>
  </figure>
</template>
