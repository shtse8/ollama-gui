<template>
  <div class="flex flex-col h-full">
    <div class="flex-1 overflow-y-auto p-4 space-y-4" ref="messagesContainer">
      <template v-if="messages.length === 0">
        <div class="flex flex-col items-center justify-center h-full">
          <div class="text-center">
            <h2 class="text-2xl font-bold mb-2">Start a new conversation</h2>
            <p class="text-gray-600 dark:text-gray-400">
              Type a message below to start chatting with the AI.
            </p>
          </div>
        </div>
      </template>
      <template v-else>
        <div v-for="message in messages" :key="message.id">
          <UserMessage v-if="message.role === 'user'" :message="message" />
          <AiMessage v-else-if="message.role === 'assistant'" :message="message" />
        </div>
      </template>
    </div>
    
    <!-- Add the BranchSelector component -->
    <BranchSelector v-if="messages.length > 0" />
    
    <ChatInput />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useChats } from '../services/chat'
import UserMessage from '../components/Messages/UserMessage.vue'
import AiMessage from '../components/Messages/AiMessage.vue'
import ChatInput from '../components/ChatInput.vue'
import BranchSelector from '../components/BranchSelector.vue'

const { messages } = useChats()

// ... existing code ...
</script>
// ... existing code ... 