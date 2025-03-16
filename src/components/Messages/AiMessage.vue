<script setup lang="ts">
import { Message } from '../../services/database.ts'
import { enableMarkdown } from '../../services/appConfig.ts'
import Markdown from '../Markdown.ts'
import 'highlight.js/styles/github-dark.css'
import logo from '/logo.png'
import { computed, ref } from 'vue'
import { IconCopy, IconCheck, IconEdit, IconX, IconDeviceFloppy } from '@tabler/icons-vue'
import { useChats } from '../../services/chat.ts'

type Props = {
  message: Message
}

const { message } = defineProps<Props>()
const thought = computed(() => {
  const end = message.content.indexOf('</think>')
  if (end != -1) {
    return [
      message.content.substring('<think>'.length, end),
      message.content.substring(end + '</think>'.length),
    ]
  } else {
    return [null, message.content]
  }
})

const copied = ref(false)
const isEditing = ref(false)
const editedContent = ref('')

const copyToClipboard = () => {
  navigator.clipboard.writeText(thought.value[1])
    .then(() => {
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 2000)
    })
    .catch(err => {
      console.error('Failed to copy text: ', err)
    })
}

const { editMessage } = useChats()

const startEditing = () => {
  editedContent.value = thought.value[1]
  isEditing.value = true
}

const cancelEditing = () => {
  isEditing.value = false
  editedContent.value = ''
}

const saveEdit = async () => {
  if (!message.id) return
  
  try {
    // Prepare the updated content
    const updatedContent = thought.value[0] 
      ? `<think>${thought.value[0]}</think>${editedContent.value}`
      : editedContent.value
      
    // Use the chat service to edit the message
    await editMessage(message.id, updatedContent)
    
    // Exit edit mode
    isEditing.value = false
  } catch (error) {
    console.error('Failed to save edited message:', error)
  }
}
</script>

<template>
  <div class="flex rounded-xl bg-gray-100 px-2 py-6 dark:bg-gray-800 sm:px-4 relative">
    <img
      class="mr-2 flex size-10 aspect-square rounded-full border border-gray-200 bg-white object-contain sm:mr-4"
      :src="logo"
      alt="Ollama"
    />

    <div class="flex flex-col max-w-3xl rounded-xl">
      <!-- Normal display mode -->
      <template v-if="!isEditing">
        <code v-if="!enableMarkdown" class="whitespace-pre-line">{{ message.content }}</code>
        <div
          v-else
          class="prose prose-base max-w-full dark:prose-invert prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-p:first:mt-0 prose-a:text-blue-600 prose-code:text-sm prose-code:text-gray-100 prose-pre:p-2 dark:prose-code:text-gray-100"
        >
          <details
            v-if="thought[0]"
            class="whitespace-pre-wrap rounded-md mb-4 border border-blue-200 bg-blue-50 p-4 text-sm leading-tight text-blue-900 dark:border-blue-700 dark:bg-blue-800 dark:text-blue-50"
          >
            <summary>Thought</summary>
            {{ thought[0] }}
          </details>
          <Markdown :source="thought[1]" />
        </div>
      </template>
      
      <!-- Edit mode -->
      <div v-else class="w-full">
        <textarea 
          v-model="editedContent"
          class="w-full h-48 p-2 rounded-md bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-sm font-mono"
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
        @click="startEditing" 
        class="p-1 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors opacity-70 hover:opacity-100"
        title="Edit message"
      >
        <IconEdit class="size-4" />
      </button>
      <button 
        @click="copyToClipboard" 
        class="p-1 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors opacity-70 hover:opacity-100"
        :title="copied ? 'Copied!' : 'Copy to clipboard'"
      >
        <IconCheck v-if="copied" class="size-4 text-green-500" />
        <IconCopy v-else class="size-4" />
      </button>
    </div>
  </div>
</template>
