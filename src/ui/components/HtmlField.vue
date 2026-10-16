<script setup lang="ts">
import Button from 'primevue/button';
import Textarea from 'primevue/textarea';
import { ref } from 'vue';
import { useI18n } from '../plugin';
import HtmlContent from './HtmlContent.vue';

// An HTML field with a preview of what participants will see (sanitized, as they'll see it)
defineProps<{
  id: string;
  label: string;
  help?: string;
  maxlength: number;
  invalid?: boolean;
}>();
const model = defineModel<string>({ required: true });
const { t } = useI18n();
const previewing = ref(false);
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <label :for="id" class="font-medium">{{ label }}</label>
      <Button
        :label="previewing ? t('buttons.editHtml') : t('buttons.preview')"
        :icon="previewing ? 'pi pi-code' : 'pi pi-eye'"
        size="small"
        text
        @click="previewing = !previewing"
      />
    </div>
    <div
      v-if="previewing"
      class="rounded-md border border-surface-200 bg-surface-0 p-4"
    >
      <HtmlContent v-if="model.trim()" :html="model" />
      <p v-else class="text-surface-500">{{ t('common.empty') }}</p>
    </div>
    <Textarea
      v-else
      :id="id"
      v-model="model"
      rows="4"
      auto-resize
      :maxlength="maxlength"
      :invalid="invalid"
      class="font-mono text-sm"
      :aria-describedby="help ? `${id}-help` : undefined"
    />
    <small v-if="help" :id="`${id}-help`" class="text-surface-500">{{
      help
    }}</small>
  </div>
</template>
