<script setup lang="ts">
import { Message } from '../../services/database.ts'
import { avatarUrl, enableMarkdown } from '../../services/appConfig.ts'
import Markdown from '../Markdown.ts'
import { ref } from 'vue'
import { IconEdit, IconX, IconDeviceFloppy, IconSend } from '@tabler/icons-vue'
import { useChats } from '../../services/chat.ts'

type Props = {
  message: Message
}

const { message } = defineProps<Props>()
const isEditing = ref(false)
const editedContent = ref('')
const isGenerating = ref(false)

const { editMessage, addUserMessage } = useChats()

const startEditing = () => {
  editedContent.value = message.content
  isEditing.value = true
}

const cancelEditing = () => {
  isEditing.value = false
  editedContent.value = ''
}

const saveEdit = async () => {
  if (!message.id) {
    console.error('Cannot save edit: message has no ID')
    return
  }
  
  console.log('Saving edited message with ID:', message.id)
  console.log('Original content:', message.content)
  console.log('Edited content:', editedContent.value)
  
  try {
    console.log('Calling editMessage function...')
    await editMessage(message.id, editedContent.value)
    console.log('Edit saved successfully')
    isEditing.value = false
  } catch (error) {
    console.error('Failed to save edited message:', error)
  }
}

const generateNewResponse = async () => {
  if (isGenerating.value) return
  
  isGenerating.value = true
  try {
    console.log('Generating new response for edited message')
    await addUserMessage(message.content)
    console.log('New response generated')
  } catch (error) {
    console.error('Failed to generate new response:', error)
  } finally {
    isGenerating.value = false
  }
}
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
          {{ message.content }}
        </code>
        <div
          v-else
          class="prose prose-base max-w-full dark:prose-invert prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-p:text-gray-900 prose-p:first:mt-0 prose-a:text-blue-600 prose-code:text-sm prose-code:text-gray-900 prose-pre:p-2 dark:prose-p:text-gray-100 dark:prose-code:text-gray-100"
        >
          <Markdown :source="message.content" />
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
            @click="cancelEditing" 
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
    
    <!-- Action buttons -->
    <div v-if="!isEditing" class="absolute bottom-2 right-2 flex space-x-2">
      <button 
        @click="generateNewResponse" 
        class="p-1 rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors opacity-70 hover:opacity-100"
        title="Generate new response"
        :disabled="isGenerating"
      >
        <IconSend class="size-4" :class="{ 'animate-pulse': isGenerating }" />
      </button>
      <button 
        @click="startEditing" 
        class="p-1 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors opacity-70 hover:opacity-100"
        title="Edit message"
      >
        <IconEdit class="size-4" />
      </button>
    </div>
  </div>
</template>
