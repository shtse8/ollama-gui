import { computed, ref } from 'vue'
import { Chat, db, Message } from './database'
import { historyMessageLength, currentModel, useConfig } from './appConfig'
import { useAI } from './useAI.ts'
import { ChatCompletedResponse, ChatPartResponse, useApi } from './api.ts'
import { v4 as uuidv4 } from 'uuid'
import { useModels } from './models'
import { useToast } from './toast'

interface ChatExport extends Chat {
  messages: Message[]
}

// State
const chats = ref<Chat[]>([])
const activeChat = ref<Chat | null>(null)
const messages = ref<Message[]>([])
const systemPrompt = ref<Message>()
const ongoingAiMessages = ref<Map<number, Message>>(new Map())
const currentChatId = ref<number | null>(null)
const isGenerating = ref(false)
const abortController = ref<AbortController | null>(null)
const streamingMessage = ref<Message | null>(null)
const isStreaming = computed(() => streamingMessage.value !== null)

// Database Layer
const dbLayer = {
  async getAllChats() {
    return db.chats.toArray()
  },

  async getChat(chatId: number) {
    return db.chats.get(chatId)
  },

  async getMessages(chatId: number) {
    return db.messages.where('chatId').equals(chatId).toArray()
  },

  async addChat(chat: Chat) {
    return db.chats.add(chat)
  },

  async updateChat(chatId: number, updates: Partial<Chat>) {
    return db.chats.update(chatId, updates)
  },

  async addMessage(message: Message) {
    return db.messages.add(message)
  },

  async updateMessage(messageId: number, updates: Partial<Message>) {
    return db.messages.update(messageId, updates)
  },

  async deleteChat(chatId: number) {
    return db.chats.delete(chatId)
  },

  async deleteMessagesOfChat(chatId: number) {
    return db.messages.where('chatId').equals(chatId).delete()
  },

  async deleteMessage(messageId: number) {
    return db.messages.delete(messageId)
  },

  async clearChats() {
    return db.chats.clear()
  },

  async clearMessages() {
    return db.messages.clear()
  },
}

export function useChats() {
  const { generate } = useAI()
  const { abort } = useApi()
  const $toast = useToast()
  const { getSystemPrompt, getCurrentSystemMessage } = useConfig()
  const { getModel } = useModels()

  // Computed
  const sortedChats = computed<Chat[]>(() =>
    [...chats.value].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  )
  const hasActiveChat = computed(() => activeChat.value !== null)
  const hasMessages = computed(() => messages.value.length > 0)

  // Methods for state mutations
  const setActiveChat = (chat: Chat) => (activeChat.value = chat)
  const setMessages = (newMessages: Message[]) => (messages.value = newMessages)

  const initialize = async () => {
    try {
      chats.value = await dbLayer.getAllChats()
      if (chats.value.length > 0) {
        await switchChat(sortedChats.value[0].id!)
      } else {
        await startNewChat('New chat')
      }
    } catch (error) {
      console.error('Failed to initialize chats:', error)
    }
  }

  const switchChat = async (chatId: number) => {
    try {
      const chat = await dbLayer.getChat(chatId)
      if (chat) {
        setActiveChat(chat)
        const chatMessages = await dbLayer.getMessages(chatId)
        setMessages(chatMessages)
        if (activeChat.value) {
          await switchModel(activeChat.value.model)
        }
      }
    } catch (error) {
      console.error(`Failed to switch to chat with ID ${chatId}:`, error)
    }
  }

  const switchModel = async (model: string) => {
    currentModel.value = model
    if (!activeChat.value) return

    try {
      await dbLayer.updateChat(activeChat.value.id!, { model })
      activeChat.value.model = model
    } catch (error) {
      console.error(`Failed to switch model to ${model}:`, error)
    }
  }

  const renameChat = async (newName: string) => {
    if (!activeChat.value) return

    activeChat.value.name = newName
    await dbLayer.updateChat(activeChat.value.id!, { name: newName })
    chats.value = await dbLayer.getAllChats()
  }

  const startNewChat = async (name: string) => {
    const newChat: Chat = {
      name,
      model: currentModel.value,
      createdAt: new Date(),
    }

    try {
      newChat.id = await dbLayer.addChat(newChat)
      chats.value.push(newChat)
      setActiveChat(newChat)
      setMessages([])
      await addSystemMessage(await getCurrentSystemMessage())
    } catch (error) {
      console.error('Failed to start a new chat:', error)
    }
  }

  const addSystemMessage = async (content: string | null, meta?: any) => {
    if (!activeChat.value) return
    if (!content) return

    const systemPromptMessage: Message = {
      chatId: activeChat.value.id!,
      role: 'system',
      content,
      meta,
      createdAt: new Date(),
    }

    systemPromptMessage.id = await dbLayer.addMessage(systemPromptMessage)
    messages.value.push(systemPromptMessage)

    systemPrompt.value = systemPromptMessage
  }

  const addUserMessage = async (content: string) => {
    console.log('Adding user message:', content)
    
    if (!activeChat.value) {
      console.warn('There was no active chat.')
      return
    }

    const currentChatId = activeChat.value.id!
    const message: Message = {
      chatId: activeChat.value.id!,
      role: 'user',
      content,
      createdAt: new Date(),
    }

    try {
      console.log('Saving message to database...')
      message.id = await dbLayer.addMessage(message)
      console.log('Message saved with ID:', message.id)
      
      messages.value.push(message)
      console.log('Message added to UI, messages count:', messages.value.length)

      console.log('Generating AI response...')
      await generate(
        currentModel.value,
        messages.value,
        systemPrompt.value,
        historyMessageLength.value,
        (data) => {
          console.log('Partial response received:', data.message.content.substring(0, 20) + '...')
          handleAiPartialResponse(data, currentChatId)
        },
        (data) => {
          console.log('Response completed')
          handleAiCompletion(data, currentChatId)
        },
      )
      console.log('AI response generation completed')
      return true
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.log('Request aborted')
          ongoingAiMessages.value.delete(currentChatId)
          return
        }
      }

      console.error('Failed to add user message:', error)
      throw error
    }
  }

  const regenerateResponse = async () => {
    if (!activeChat.value) return
    const currentChatId = activeChat.value.id!
    const message = messages.value[messages.value.length - 1]
    if (message && message.role === 'assistant') {
      if (message.id) db.messages.delete(message.id)
      messages.value.pop()
    }
    try {
      await generate(
        currentModel.value,
        messages.value,
        systemPrompt.value,
        historyMessageLength.value,
        (data) => handleAiPartialResponse(data, currentChatId),
        (data) => handleAiCompletion(data, currentChatId),
      )
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          ongoingAiMessages.value.delete(currentChatId)
          return
        }
      }
      console.error('Failed to regenerate response:', error)
    }
  }

  const handleAiPartialResponse = (data: ChatPartResponse, chatId: number) => {
    console.log('Handling partial response for chat ID:', chatId)
    
    if (ongoingAiMessages.value.has(chatId)) {
      console.log('Appending to existing AI message')
      appendToAiMessage(data.message.content, chatId)
    } else {
      console.log('Starting new AI message')
      startAiMessage(data.message.content, chatId)
    }
  }

  const handleAiCompletion = async (data: ChatCompletedResponse, chatId: number) => {
    console.log('Handling completion for chat ID:', chatId)
    
    const aiMessage = ongoingAiMessages.value.get(chatId)
    if (aiMessage) {
      try {
        console.log('Finalizing AI message with ID:', aiMessage.id)
        ongoingAiMessages.value.delete(chatId)
      } catch (error) {
        console.error('Failed to finalize AI message:', error)
      }
    } else {
      console.error('No ongoing message to finalize for chat ID:', chatId)
      debugger
    }
  }

  const wipeDatabase = async () => {
    try {
      await dbLayer.clearChats()
      await dbLayer.clearMessages()

      // Reset local state
      chats.value = []
      activeChat.value = null
      messages.value = []
      ongoingAiMessages.value.clear()

      await startNewChat('New chat')
    } catch (error) {
      console.error('Failed to wipe the database:', error)
    }
  }

  const deleteChat = async (chatId: number) => {
    try {
      await dbLayer.deleteChat(chatId)
      await dbLayer.deleteMessagesOfChat(chatId)

      chats.value = chats.value.filter((chat) => chat.id !== chatId)

      if (activeChat.value?.id === chatId) {
        if (sortedChats.value.length) {
          await switchChat(sortedChats.value[0].id!)
        } else {
          await startNewChat('New chat')
        }
      }
    } catch (error) {
      console.error(`Failed to delete chat with ID ${chatId}:`, error)
    }
  }

  const startAiMessage = async (initialContent: string, chatId: number) => {
    console.log('Starting AI message for chat ID:', chatId)
    
    const message: Message = {
      chatId: chatId,
      role: 'assistant',
      content: initialContent,
      createdAt: new Date(),
    }

    try {
      console.log('Saving AI message to database...')
      message.id = await dbLayer.addMessage(message)
      console.log('AI message saved with ID:', message.id)
      
      ongoingAiMessages.value.set(chatId, message)
      console.log('Added message to ongoingAiMessages map')
      
      messages.value.push(message)
      console.log('Added message to UI, messages count:', messages.value.length)
    } catch (error) {
      console.error('Failed to start AI message:', error)
    }
  }

  const appendToAiMessage = async (content: string, chatId: number) => {
    console.log('Appending to AI message for chat ID:', chatId)
    
    const aiMessage = ongoingAiMessages.value.get(chatId)
    if (aiMessage) {
      console.log('Found ongoing AI message with ID:', aiMessage.id)
      aiMessage.content += content
      
      try {
        console.log('Updating AI message in database...')
        await dbLayer.updateMessage(aiMessage.id!, { content: aiMessage.content })
        console.log('AI message updated in database')

        // Only "load the messages" if we are on this chat atm.
        if (chatId == activeChat.value?.id) {
          console.log('Reloading messages for active chat')
          setMessages(await dbLayer.getMessages(chatId))
          console.log('Messages reloaded, count:', messages.value.length)
        }
      } catch (error) {
        console.error('Failed to append to AI message:', error)
      }
    } else {
      console.error('No ongoing AI message found for chat ID:', chatId)
    }
  }

  const exportChats = async () => {
    const chats = await dbLayer.getAllChats()
    const exportData: ChatExport[] = []
    await Promise.all(chats.map(async chat => {
      if (!chat?.id) return
      const messages = await dbLayer.getMessages(chat.id)
      exportData.push(Object.assign({ messages }, chat))
    }))
    return exportData
  }

  const importChats = async (jsonData: ChatExport[]) => {
    jsonData.forEach(async chatData => {
      const chat: Chat = {
        name: chatData?.name,
        model: chatData?.model,
        createdAt: new Date(chatData?.createdAt || chatData.messages[0].createdAt),
      }
      chat.id = await dbLayer.addChat(chat)
      chats.value.push(chat)
      chatData.messages.forEach(async messageData => {
        const message: Message = {
          chatId: chat.id!,
          role: messageData.role,
          content: messageData.content,
          createdAt: new Date(messageData.createdAt),
        }
        await dbLayer.addMessage(message)
      })
    })
  }

  const editMessage = async (messageId: number, newContent: string) => {
    console.log('Editing message with ID:', messageId)
    console.log('New content:', newContent)
    
    if (!activeChat.value) {
      console.error('No active chat found')
      return
    }
    
    try {
      console.log('Updating message in database...')
      // Update the message in the database
      await dbLayer.updateMessage(messageId, { content: newContent })
      console.log('Message updated in database')
      
      // Update the message in the UI
      const index = messages.value.findIndex(m => m.id === messageId)
      console.log('Message index in UI array:', index)
      
      if (index !== -1) {
        console.log('Updating message in UI')
        messages.value[index].content = newContent
        console.log('Message updated in UI')
        
        // If this is not the last message, we need to remove all subsequent messages
        // as they would no longer make sense in the conversation
        if (index < messages.value.length - 1) {
          console.log('Message is not the last one, removing subsequent messages')
          const subsequentMessages = messages.value.slice(index + 1)
          console.log('Subsequent messages count:', subsequentMessages.length)
          
          // Delete subsequent messages from the database
          for (const msg of subsequentMessages) {
            if (msg.id) {
              console.log('Deleting message with ID:', msg.id)
              await dbLayer.deleteMessage(msg.id)
              console.log('Message deleted from database')
            }
          }
          
          // Remove subsequent messages from the UI
          console.log('Removing subsequent messages from UI')
          messages.value = messages.value.slice(0, index + 1)
          console.log('Messages after removal:', messages.value.length)
          
          // Generate a new AI response based on the edited message
          console.log('Generating new AI response based on edited message')
          const currentChatId = activeChat.value.id!
          
          try {
            await generate(
              currentModel.value,
              messages.value,
              systemPrompt.value,
              historyMessageLength.value,
              (data) => handleAiPartialResponse(data, currentChatId),
              (data) => handleAiCompletion(data, currentChatId)
            )
            console.log('New AI response generated successfully')
          } catch (error) {
            console.error('Failed to generate new AI response:', error)
          }
        } else {
          console.log('Message is the last one, no need to remove subsequent messages')
        }
      } else {
        console.error('Message not found in UI array')
      }
    } catch (error) {
      console.error(`Failed to edit message with ID ${messageId}:`, error)
      throw error
    }
  }

  const getCurrentChat = async () => {
    if (!currentChatId.value) return null
    return await dbLayer.getChat(currentChatId.value)
  }

  const getActiveBranchId = async () => {
    const chat = await getCurrentChat()
    return chat?.activeBranchId
  }

  const setActiveBranch = async (branchId: number) => {
    if (!currentChatId.value) return
    
    console.log(`Setting active branch to ${branchId} for chat ${currentChatId.value}`)
    await dbLayer.updateChat(currentChatId.value, { activeBranchId: branchId })
    
    // Reload messages for the current chat with the new active branch
    await loadMessages()
  }

  const createNewBranch = async (parentMessageId: number) => {
    if (!currentChatId.value) return
    
    // Get the parent message
    const parentMessage = await dbLayer.getMessages(currentChatId.value).then(messages => messages.find(m => m.id === parentMessageId))
    if (!parentMessage) {
      console.error(`Parent message ${parentMessageId} not found`)
      return
    }
    
    console.log(`Creating new branch from message ${parentMessageId}`)
    
    // Generate a new branch ID
    const branchId = Date.now()
    
    // Set this as the active branch
    await setActiveBranch(branchId)
    
    return branchId
  }

  const loadMessages = async () => {
    console.log('Loading messages for chat', currentChatId.value)
    if (!currentChatId.value) {
      messages.value = []
      return
    }

    try {
      const chat = await getCurrentChat()
      const activeBranchId = chat?.activeBranchId
      
      console.log(`Loading messages for chat ${currentChatId.value}, active branch: ${activeBranchId}`)
      
      let chatMessages
      if (activeBranchId) {
        // Load messages for the active branch
        chatMessages = await dbLayer.getMessages(currentChatId.value).then(messages => messages.filter(m => m.branchId === activeBranchId || m.branchId === undefined))
      } else {
        // Load all messages for the chat (no branching)
        chatMessages = await dbLayer.getMessages(currentChatId.value)
      }
      
      messages.value = chatMessages
      console.log(`Loaded ${chatMessages.length} messages`)
    } catch (error) {
      console.error('Error loading messages:', error)
      $toast.error('Failed to load messages')
    }
  }

  const sendMessage = async (content: string) => {
    console.log('Sending message:', content)
    if (!currentChatId.value || !content.trim()) return

    try {
      const activeBranchId = await getActiveBranchId()
      
      // Create a new message
      const userMessage: Message = {
        chatId: currentChatId.value,
        role: 'user',
        content,
        createdAt: new Date(),
        branchId: activeBranchId,
        order: messages.value.length
      }

      // Save the message to the database
      const messageId = await dbLayer.addMessage(userMessage)
      console.log('Saved user message with ID:', messageId)

      // Add the message to the messages array
      userMessage.id = messageId
      messages.value.push(userMessage)

      // Generate a response
      await generateAIResponse()
    } catch (error) {
      console.error('Error sending message:', error)
      $toast.error('Failed to send message')
    }
  }

  const editMessageWithBranching = async (messageId: number, newContent: string) => {
    console.log(`Editing message ${messageId} with new content:`, newContent)
    
    try {
      const activeChat = await getCurrentChat()
      if (!activeChat?.id) return
      
      // Get the message to edit
      const allMessages = await dbLayer.getMessages(activeChat.id)
      const message = allMessages.find(m => m.id === messageId)
      if (!message) {
        console.error(`Message ${messageId} not found`)
        return
      }
      
      // Create a new branch from this message
      const newBranchId = await createNewBranch(messageId)
      console.log(`Created new branch ${newBranchId} for edited message`)
      
      // Update the message in the database
      await dbLayer.updateMessage(messageId, { 
        content: newContent,
        branchId: newBranchId
      })
      console.log(`Updated message ${messageId} in database`)
      
      // Update the message in the UI
      const index = messages.value.findIndex(m => m.id === messageId)
      if (index !== -1) {
        messages.value[index].content = newContent
        messages.value[index].branchId = newBranchId
      }
      
      // Remove all subsequent messages from this branch
      if (index !== -1) {
        const subsequentMessages = messages.value.slice(index + 1)
        console.log(`Removing ${subsequentMessages.length} subsequent messages`)
        messages.value = messages.value.slice(0, index + 1)
      }
      
      // Generate a new AI response
      await addUserMessage(newContent)
    } catch (error) {
      console.error('Error editing message with branching:', error)
    }
  }

  const generateAIResponse = async () => {
    if (!currentChatId.value) return
    
    try {
      isGenerating.value = true
      
      const activeBranchId = await getActiveBranchId()
      const systemPrompt = await getSystemPrompt()
      const model = await getModel()
      
      // Create a new message for the AI response
      const aiMessage: Message = {
        chatId: currentChatId.value,
        role: 'assistant',
        content: '',
        createdAt: new Date(),
        branchId: activeBranchId,
        order: messages.value.length
      }
      
      // Save the message to the database
      const messageId = await dbLayer.addMessage(aiMessage)
      console.log('Created AI message with ID:', messageId)
      
      // Add the message to the messages array
      aiMessage.id = messageId
      messages.value.push(aiMessage)
      
      // Set the streaming message
      streamingMessage.value = aiMessage
      
      // Create a new abort controller
      abortController.value = new AbortController()
      
      // Generate the response
      await generate(
        model,
        messages.value,
        systemPrompt ? { 
          chatId: currentChatId.value, 
          role: 'system', 
          content: systemPrompt, 
          createdAt: new Date() 
        } : undefined,
        historyMessageLength.value,
        (data) => {
          // Update the message in the UI
          if (streamingMessage.value) {
            streamingMessage.value.content = data.message.content
          }
          
          // Update the message in the database
          if (messageId) {
            dbLayer.updateMessage(messageId, { content: data.message.content })
          }
        },
        (data) => {
          console.log('Response completed')
          handleAiCompletion(data, currentChatId.value as number)
        }
      )
      
      // Reset the streaming message
      streamingMessage.value = null
    } catch (error: any) {
      console.error('Error generating AI response:', error)
      if (error.name !== 'AbortError') {
        $toast.error('Failed to generate AI response')
      }
    } finally {
      isGenerating.value = false
      abortController.value = null
    }
  }

  const getBranches = async () => {
    const activeChat = await getCurrentChat()
    if (!activeChat?.id) return []
    
    try {
      // Get all unique branch IDs for this chat
      const allMessages = await dbLayer.getMessages(activeChat.id)
      
      // Group messages by branch ID
      const branches = allMessages.reduce((acc, message) => {
        if (message.branchId) {
          if (!acc[message.branchId]) {
            acc[message.branchId] = []
          }
          acc[message.branchId].push(message)
        }
        return acc
      }, {} as Record<number, Message[]>)
      
      // Convert to array and sort by creation date (newest first)
      return Object.entries(branches)
        .map(([branchId, messages]) => ({
          id: Number(branchId),
          messages,
          createdAt: Math.max(...messages.map(m => m.createdAt.getTime()))
        }))
        .sort((a, b) => b.createdAt - a.createdAt)
    } catch (error) {
      console.error('Error getting branches:', error)
      return []
    }
  }

  return {
    chats,
    sortedChats,
    activeChat,
    messages,
    hasMessages,
    hasActiveChat,
    renameChat,
    switchModel,
    startNewChat,
    switchChat,
    deleteChat,
    addUserMessage,
    regenerateResponse,
    addSystemMessage,
    initialize,
    wipeDatabase,
    abort,
    exportChats,
    importChats,
    editMessage,
    currentChatId,
    isGenerating,
    isStreaming,
    streamingMessage,
    loadMessages,
    sendMessage,
    getBranches,
    setActiveBranch,
    createNewBranch,
    getActiveBranchId,
    editMessageWithBranching
  }
}
