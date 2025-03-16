<script setup lang="ts">
import { Message } from '../../services/database.ts'
import { enableMarkdown } from '../../services/appConfig.ts'
import Markdown from '../Markdown.ts'
import 'highlight.js/styles/github-dark.css'
import logo from '/logo.png'
import { computed, ref } from 'vue'
import { IconCopy, IconCheck, IconRefresh } from '@tabler/icons-vue'
import { useChats } from '../../services/chat.ts'
import { useAI } from '../../services/useAI.ts'
import { currentModel, historyMessageLength } from '../../services/appConfig.ts'
import { db } from '../../services/database.ts'
import { useApi } from '../../services/api.ts'

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
const isRegenerating = ref(false)

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

const { messages } = useChats()
const { generate } = useAI()
const { abort } = useApi()

const regenerateMessage = async () => {
  if (!message.id || !message.chatId) return
  
  isRegenerating.value = true
  
  try {
    // Get all messages up to this one
    const allMessages = await db.messages.where('chatId').equals(message.chatId).toArray()
    const systemMessage = allMessages.find(m => m.role === 'system')
    
    // Find the index of the current message
    const currentIndex = allMessages.findIndex(m => m.id === message.id)
    if (currentIndex === -1) return
    
    // Get all messages up to but not including the current one
    const previousMessages = allMessages.slice(0, currentIndex)
    
    // Delete the current message
    if (message.id) await db.messages.delete(message.id)
    
    // Find the message in the reactive array and remove it
    const reactiveIndex = messages.value.findIndex(m => m.id === message.id)
    if (reactiveIndex !== -1) {
      messages.value.splice(reactiveIndex, 1)
    }
    
    // Generate a new response
    await generate(
      currentModel.value,
      previousMessages,
      systemMessage,
      historyMessageLength.value,
      (data) => {
        // Handle partial response
        const existingMessage = messages.value.find(m => m.chatId === message.chatId && m.role === 'assistant' && !m.id)
        if (existingMessage) {
          existingMessage.content += data.content
        } else {
          // Create a new message
          const newMessage = {
            chatId: message.chatId,
            role: 'assistant' as const,
            content: data.content,
            createdAt: new Date(),
          }
          messages.value.push(newMessage)
        }
      },
      async (data) => {
        // Handle completion
        const existingMessage = messages.value.find(m => m.chatId === message.chatId && m.role === 'assistant' && !m.id)
        if (existingMessage) {
          // Save the message to the database
          const id = await db.messages.add({
            ...existingMessage,
            content: data.content,
          })
          existingMessage.id = id
          existingMessage.content = data.content
        }
        isRegenerating.value = false
      }
    )
  } catch (error) {
    console.error('Failed to regenerate message:', error)
    isRegenerating.value = false
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
    </div>
    <div class="absolute bottom-2 right-2 flex space-x-2">
      <button 
        @click="regenerateMessage" 
        class="p-1 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors opacity-70 hover:opacity-100"
        :title="isRegenerating ? 'Regenerating...' : 'Regenerate response'"
        :disabled="isRegenerating"
      >
        <IconRefresh class="size-4" :class="{ 'animate-spin': isRegenerating }" />
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
