<template>
  <div class="min-h-screen bg-gray-50">
    <div class="container mx-auto px-4 py-6">
      <div v-if="loading" class="text-center py-16">
        <el-icon class="animate-spin text-4xl text-gray-400"><Loading /></el-icon>
      </div>

      <template v-else>
        <el-card v-if="need">
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <el-button type="text" @click="$router.back()" class="mr-4">
                  <el-icon><ArrowLeft /></el-icon>
                </el-button>
                <h1 class="text-xl font-bold">{{ need.title }}</h1>
                <el-tag :type="getTypeColor(need.type)" class="ml-4">
                  {{ getTypeName(need.type) }}
                </el-tag>
              </div>
              <el-tag v-if="need.status === 'pending'" type="success">待接单</el-tag>
              <el-tag v-else-if="need.status === 'accepted'" type="warning">服务中</el-tag>
              <el-tag v-else-if="need.status === 'completed'" type="info">已完成</el-tag>
            </div>
          </template>

          <div class="mb-6">
            <div class="prose max-w-none">
              <p class="text-gray-700 mb-4">{{ need.description }}</p>
            </div>

            <div class="grid grid-cols-2 gap-4 mt-6">
              <div class="flex items-center text-gray-600">
                <el-icon class="mr-2 text-gray-400"><Location /></el-icon>
                <span>{{ need.address }}</span>
              </div>
              <div class="flex items-center text-gray-600">
                <el-icon class="mr-2 text-gray-400"><User /></el-icon>
                <span>{{ need.user_name }}</span>
              </div>
              <div class="flex items-center text-gray-600">
                <el-icon class="mr-2 text-gray-400"><Phone /></el-icon>
                <span>{{ need.user_phone }}</span>
              </div>
              <div v-if="need.expected_time" class="flex items-center text-gray-600">
                <el-icon class="mr-2 text-gray-400"><Clock /></el-icon>
                <span>{{ new Date(need.expected_time).toLocaleString() }}</span>
              </div>
            </div>
          </div>

          <!-- 接单后的服务进度：志愿者提交时长 -> 居民确认 -> 完成 -->
          <el-card v-if="need.order_id" shadow="never" class="mb-6 bg-gray-50">
            <template #header>
              <span class="font-medium">服务进度</span>
            </template>
            <el-steps :active="stepActive" finish-status="success" align-center>
              <el-step title="进行中" description="志愿者正在服务" />
              <el-step title="待确认" :description="need.order_status === 'pending_confirm' ? `已提交 ${need.service_hours} 小时，等待居民确认` : '志愿者提交服务时长'" />
              <el-step title="已完成" description="居民确认并结算积分" />
            </el-steps>

            <div class="mt-4 text-sm">
              <p v-if="need.volunteer_name" class="text-gray-600 mb-2">
                <el-icon class="mr-1"><Service /></el-icon>
                服务志愿者：{{ need.volunteer_name }}
              </p>
              <p v-if="Number(need.service_hours) > 0" class="text-gray-600 mb-2">
                <el-icon class="mr-1"><Clock /></el-icon>
                服务时长：{{ need.service_hours }} 小时
                <span v-if="need.order_status === 'pending_confirm'" class="text-gray-400">
                  （确认后结算 {{ Number(need.service_hours) * 10 }} 积分）
                </span>
                <span v-else-if="need.order_status === 'completed'" class="text-green-600">
                  （已结算 {{ Number(need.service_hours) * 10 }} 积分）
                </span>
              </p>
              <p class="text-gray-500">{{ statusHint }}</p>
            </div>
          </el-card>

          <!-- 待接单 -->
          <div class="flex justify-end gap-3" v-if="user?.role === 'volunteer' && need.status === 'pending'">
            <el-button type="primary" size="large" :loading="accepting" @click="handleAccept">
              我要接单
            </el-button>
          </div>
          <div v-else-if="user?.id === need.user_id && need.status === 'pending'" class="text-right">
            <el-tag type="info">等待志愿者接单</el-tag>
          </div>

          <!-- 进行中：志愿者提交服务时长 -->
          <div v-else-if="need.order_status === 'in_progress'" class="flex justify-end gap-3">
            <el-button
              v-if="user?.id === need.volunteer_id"
              type="primary"
              size="large"
              @click="openSubmitDialog"
            >
              提交服务时长
            </el-button>
            <el-tag v-else-if="user?.id === need.user_id" type="info" size="large">
              等待志愿者提交服务时长
            </el-tag>
          </div>

          <!-- 待确认：居民确认或退回 -->
          <div v-else-if="need.order_status === 'pending_confirm'" class="flex justify-end gap-3">
            <template v-if="user?.id === need.user_id">
              <el-button type="warning" plain size="large" :loading="acting" @click="handleReject">
                退回
              </el-button>
              <el-button type="success" size="large" :loading="acting" @click="handleConfirm">
                确认完成
              </el-button>
            </template>
            <el-tag v-else-if="user?.id === need.volunteer_id" type="info" size="large">
              已提交 {{ need.service_hours }} 小时，等待居民确认
            </el-tag>
          </div>

          <!-- 已完成 -->
          <div v-else-if="need.order_status === 'completed'" class="flex justify-end">
            <el-tag type="success" size="large">居民已确认，服务完成</el-tag>
          </div>
        </el-card>
      </template>
    </div>

    <!-- 志愿者提交服务时长 -->
    <el-dialog v-model="submitDialogVisible" title="提交服务时长" width="420px">
      <el-form label-width="100px">
        <el-form-item label="服务时长">
          <el-input-number v-model="submitForm.service_hours" :min="1" :max="12" :step="1" :precision="0" />
          <span class="ml-2 text-gray-500 text-sm">小时（1-12）</span>
        </el-form-item>
        <div class="text-sm text-gray-500 pl-2">
          提交后订单进入「待确认」，居民确认后按每小时 10 积分结算
          （本次预计 {{ submitForm.service_hours * 10 }} 积分）。
        </div>
      </el-form>
      <template #footer>
        <el-button @click="submitDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitHours">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import api from '@/utils/api'
import { ElMessage, ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const user = computed(() => userStore.user)

const need = ref(null)
const loading = ref(true)
const accepting = ref(false)
const acting = ref(false)

const submitDialogVisible = ref(false)
const submitting = ref(false)
const submitForm = ref({ service_hours: 1 })

const typeMap = {
  accompany: { name: '陪聊陪诊', color: 'blue' },
  shopping: { name: '代买代办', color: 'green' },
  repair: { name: '家电维修', color: 'orange' },
  housework: { name: '家政服务', color: 'purple' },
  other: { name: '其他帮助', color: 'gray' }
}

const getTypeName = (type) => typeMap[type]?.name || type
const getTypeColor = (type) => typeMap[type]?.color || 'info'

const stepActive = computed(() => {
  if (need.value?.order_status === 'in_progress') return 0
  if (need.value?.order_status === 'pending_confirm') return 1
  if (need.value?.order_status === 'completed') return 2
  return 0
})

const statusHint = computed(() => {
  if (!need.value?.order_id) return ''
  const isResident = user.value?.id === need.value.user_id
  switch (need.value.order_status) {
    case 'in_progress':
      return isResident
        ? '志愿者正在服务中，完成后会提交服务时长请您确认。'
        : '服务完成后请提交 1-12 小时的服务时长，提交后等待居民确认。'
    case 'pending_confirm':
      return isResident
        ? `志愿者提交了 ${need.value.service_hours} 小时服务时长，请确认完成或退回；退回后志愿者可重新提交。`
        : `已提交 ${need.value.service_hours} 小时服务时长，等待居民确认；如被退回可修改后重新提交。`
    case 'completed':
      return '居民已确认，服务时长与积分已结算完成。'
    default:
      return ''
  }
})

const fetchNeed = async () => {
  loading.value = true
  try {
    const res = await api.get(`/needs/${route.params.id}`)
    need.value = res.data.need
  } finally {
    loading.value = false
  }
}

const handleAccept = async () => {
  try {
    await ElMessageBox.confirm('确定要接这个需求吗？', '确认接单', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'info'
    })

    accepting.value = true
    await api.post(`/needs/${route.params.id}/accept`)
    ElMessage.success('接单成功')
    fetchNeed()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.response?.data?.message || '接单失败')
    }
  } finally {
    accepting.value = false
  }
}

const openSubmitDialog = () => {
  submitForm.value = { service_hours: 1 }
  submitDialogVisible.value = true
}

const submitHours = async () => {
  try {
    submitting.value = true
    await api.put(`/orders/${need.value.order_id}/submit`, {
      service_hours: submitForm.value.service_hours
    })
    ElMessage.success('已提交，等待居民确认')
    submitDialogVisible.value = false
    fetchNeed()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

const handleConfirm = async () => {
  try {
    await ElMessageBox.confirm(
      `确认本次服务时长为 ${need.value.service_hours} 小时吗？确认后将按每小时 10 积分结算给志愿者。`,
      '确认服务完成',
      {
        confirmButtonText: '确认完成',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    acting.value = true
    const res = await api.put(`/orders/${need.value.order_id}/confirm`)
    ElMessage.success(res.data?.message || '服务已完成')
    fetchNeed()
    userStore.fetchUserInfo()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.response?.data?.message || '操作失败')
    }
  } finally {
    acting.value = false
  }
}

const handleReject = async () => {
  try {
    await ElMessageBox.confirm(
      '退回后订单将重新进入进行中，志愿者可修改服务时长后重新提交。',
      '退回服务时长',
      {
        confirmButtonText: '确认退回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    acting.value = true
    await api.put(`/orders/${need.value.order_id}/reject`)
    ElMessage.success('已退回，订单重新进入进行中')
    fetchNeed()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.response?.data?.message || '操作失败')
    }
  } finally {
    acting.value = false
  }
}

onMounted(() => {
  fetchNeed()
})
</script>
