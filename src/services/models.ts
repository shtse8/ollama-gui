import { ref } from 'vue'
import { useApi, Model } from './api'
import { currentModel } from './appConfig'

export function useModels() {
  const { listLocalModels } = useApi()
  const availableModels = ref<Model[]>([])

  const refreshModels = async () => {
    try {
      const response = await listLocalModels()
      availableModels.value = response.models
      return response.models
    } catch (error) {
      console.error('Error refreshing models:', error)
      return []
    }
  }

  const getModel = async () => {
    return currentModel.value
  }

  return {
    availableModels,
    refreshModels,
    getModel
  }
} 