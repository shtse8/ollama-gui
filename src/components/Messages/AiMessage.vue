<script setup lang="ts">
import { Message } from '../../services/database.ts'
import { enableMarkdown } from '../../services/appConfig.ts'
import Markdown from '../Markdown.ts'
import 'highlight.js/styles/github-dark.css'
import logo from '/logo.png'
import { computed, ref } from 'vue'
import { IconCopy, IconCheck, IconRefresh, IconGitBranch } from '@tabler/icons-vue'
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
const isRegenerating = ref(false)
const showBranches = ref(false)

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

const { regenerateMessageWithBranch, availableBranches, switchBranch } = useChats()

const regenerateMessage = async () => {
  if (!message.id) return
  
  isRegenerating.value = true
  
  try {
    await regenerateMessageWithBranch(message.id)
  } catch (error) {
    console.error('Failed to regenerate message:', error)
  } finally {
    isRegenerating.value = false
  }
}

const toggleBranches = () => {
  showBranches.value = !showBranches.value
}

const selectBranch = async (branchId: number) => {
  await switchBranch(branchId)
  showBranches.value = false
}

// Get branches that have this message's parent as their parent
const messageBranches = computed(() => {
  if (!message.parentId) return []
  
  return availableBranches.value.filter(branch => {
    const firstAssistantMessage = branch.messages.find(m => m.role === 'assistant')
    return firstAssistantMessage && firstAssistantMessage.parentId === message.parentId
  })
})

const hasBranches = computed(() => messageBranches.value.length > 1)
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
        v-if="hasBranches"
        @click="toggleBranches" 
        class="p-1 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors opacity-70 hover:opacity-100"
        :title="showBranches ? 'Hide branches' : 'Show alternative responses'"
      >
        <IconGitBranch class="size-4" :class="{ 'text-blue-500': showBranches }" />
        <span class="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
          {{ messageBranches.length }}
        </span>
      </button>
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
    
    <!-- Branch selector dropdown -->
    <div 
      v-if="showBranches && hasBranches" 
      class="absolute bottom-10 right-2 bg-white dark:bg-gray-700 rounded-md shadow-lg p-2 z-10 w-48"
    >
      <div class="text-xs font-medium mb-2 text-gray-500 dark:text-gray-300">Alternative responses</div>
      <div 
        v-for="branch in messageBranches" 
        :key="branch.id"
        @click="selectBranch(branch.id)"
        class="p-2 text-xs rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
        :class="{ 'bg-blue-50 dark:bg-blue-900': branch.isActive }"
      >
        <div class="flex items-center">
          <IconGitBranch class="size-3 mr-1" />
          <span class="truncate">Version {{ branch.id }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
