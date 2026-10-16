<script setup lang="ts">
import { vSafeHtml } from '@unifyamerica/demleague-plugin-sdk/vue';

// HTML an org admin wrote (prompts, welcome and closing pages), sanitized by the SDK. Tailwind's reset strips
// headings and lists, so they get their look back here (the SPA's Tailwind scans these classes in dist/ui).
defineProps<{ html: string }>();
</script>

<template>
  <div
    v-safe-html="html"
    class="flex flex-col gap-3 break-words [&_a]:text-primary [&_a]:underline [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
  />
</template>
