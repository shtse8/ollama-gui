<script setup lang="ts">
import { Message } from '../../services/database.ts'
import { avatarUrl, enableMarkdown } from '../../services/appConfig.ts'
import Markdown from '../Markdown.ts'
import { ref, computed } from 'vue'
import { IconEdit, IconX, IconDeviceFloppy } from '@tabler/icons-vue'
import { useChats } from '../../services/chat'

const props = defineProps<{
  message: Message
}>()

const chat = useChats()
const isEditing = ref(false)
const editedContent = ref('')
const isGenerating = ref(false)

const startEdit = () => {
  editedContent.value = props.message.content
  isEditing.value = true
}

const cancelEdit = () => {
  isEditing.value = false
}

const saveEdit = async () => {
  console.log('Saving edit with content:', editedContent.value)
  
  if (props.message.id) {
    // Use the branching version of editMessage
    await chat.editMessageWithBranching(props.message.id, editedContent.value)
    console.log('Edit saved and new branch created')
  }
  
  isEditing.value = false
}

const formattedContent = computed(() => {
  return props.message.content.split('\n').map(line => {
    if (line.trim().startsWith('```')) {
      return line
    }
    return line
  }).join('\n')
})
</script>

<template>
  <div class="flex flex-row px-2 py-4 sm:px-4 relative">
    <img v-if="avatarUrl" class="mr-2 flex size-10 rounded-full sm:mr-4" :src="avatarUrl" />
    <div
      v-else
      class="mr-2 flex size-10 aspect-square items-center justify-center rounded-full bg-white text-center text-2xl dark:bg-gray-600 sm:mr-4"
    >
      🧑
    </div>

    <div class="flex flex-col max-w-3xl">
      <!-- Normal display mode -->
      <template v-if="!isEditing">
        <code v-if="!enableMarkdown" class="whitespace-pre-line text-gray-900 dark:text-gray-100">
          {{ formattedContent }}
        </code>
        <div
          v-else
          class="prose prose-base max-w-full dark:prose-invert prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-p:text-gray-900 prose-p:first:mt-0 prose-a:text-blue-600 prose-code:text-sm prose-code:text-gray-900 prose-pre:p-2 dark:prose-p:text-gray-100 dark:prose-code:text-gray-100"
        >
          <Markdown :source="formattedContent" />
        </div>
      </template>
      
      <!-- Edit mode -->
      <div v-else class="w-full">
        <textarea 
          v-model="editedContent"
          class="w-full h-32 p-2 rounded-md bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-sm font-mono"
          placeholder="Edit message content..."
        ></textarea>
        <div class="flex justify-end mt-2 space-x-2">
          <button 
            @click="cancelEdit" 
            class="px-2 py-1 text-xs rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
          >
            <IconX class="size-4 mr-1 inline" />
            Cancel
          </button>
          <button 
            @click="saveEdit" 
            class="px-2 py-1 text-xs rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors"
          >
            <IconDeviceFloppy class="size-4 mr-1 inline" />
            Save
          </button>
        </div>
      </div>
    </div>
    
    <!-- Edit button -->
    <div v-if="!isEditing" class="absolute bottom-2 right-2">
      <button 
        @click="startEdit" 
        class="p-1 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors opacity-70 hover:opacity-100"
        title="Edit message"
      >
        <IconEdit class="size-4" />
      </button>
    </div>
  </div>
</template>
