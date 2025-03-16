<!-- BranchSelector.vue -->
<template>
  <div class="branch-selector">
    <div v-if="branches.length > 0" class="branches-container">
      <h3 class="text-sm font-medium mb-2">Conversation Branches</h3>
      <div class="branches-list">
        <div 
          v-for="branch in branches" 
          :key="branch.id"
          class="branch-item"
          :class="{ 'active': activeBranchId === branch.id }"
          @click="selectBranch(branch.id)"
        >
          <div class="branch-info">
            <div class="branch-title">
              {{ getBranchTitle(branch) }}
            </div>
            <div class="branch-date">
              {{ formatDate(branch.createdAt) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useChats } from '../services/chat'

const chat = useChats()
const branches = ref<any[]>([])
const activeBranchId = ref<number | undefined>()

// Load branches when the component is mounted
onMounted(async () => {
  await loadBranches()
})

// Watch for changes in the active chat
watch(() => chat.activeChat, async () => {
  await loadBranches()
})

// Load branches for the current chat
const loadBranches = async () => {
  branches.value = await chat.getBranches()
  activeBranchId.value = await chat.getActiveBranchId()
}

// Select a branch
const selectBranch = async (branchId: number) => {
  await chat.setActiveBranch(branchId)
  activeBranchId.value = branchId
}

// Get a title for the branch based on its first user message
const getBranchTitle = (branch: any) => {
  const userMessages = branch.messages.filter((m: any) => m.role === 'user')
  if (userMessages.length > 0) {
    const firstMessage = userMessages[0].content
    return firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage
  }
  return `Branch ${branch.id}`
}

// Format the date
const formatDate = (timestamp: number) => {
  const date = new Date(timestamp)
  return date.toLocaleString()
}
</script>

<style scoped>
.branch-selector {
  margin-top: 1rem;
  padding: 0.5rem;
}

.branches-container {
  background-color: var(--color-bg-secondary);
  border-radius: 0.5rem;
  padding: 0.75rem;
}

.branches-list {
  max-height: 300px;
  overflow-y: auto;
}

.branch-item {
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  border-radius: 0.25rem;
  background-color: var(--color-bg-tertiary);
  cursor: pointer;
  transition: background-color 0.2s;
}

.branch-item:hover {
  background-color: var(--color-bg-hover);
}

.branch-item.active {
  background-color: var(--color-primary-light);
  border-left: 3px solid var(--color-primary);
}

.branch-info {
  display: flex;
  flex-direction: column;
}

.branch-title {
  font-weight: 500;
  margin-bottom: 0.25rem;
}

.branch-date {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}
</style> 