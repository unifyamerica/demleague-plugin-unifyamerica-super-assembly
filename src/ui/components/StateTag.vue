<script setup lang="ts">
import Tag from 'primevue/tag';
import { computed } from 'vue';
import { useI18n } from '../plugin';
import { AssemblyState } from '../types';

const props = defineProps<{ state: AssemblyState }>();
const { t } = useI18n();

const severity = computed(
  () =>
    ({
      [AssemblyState.DRAFT]: 'secondary',
      [AssemblyState.SCHEDULED]: 'info',
      [AssemblyState.RUNNING]: 'success',
      [AssemblyState.FINISHED]: 'contrast',
      [AssemblyState.CANCELED]: 'danger',
    })[props.state],
);
</script>

<template>
  <Tag :value="t(`states.${state}`)" :severity="severity" />
</template>
