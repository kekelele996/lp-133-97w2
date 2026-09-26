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
              <el-tag v-else-if="need.status === 'accepted' && need.order_status === 'in_progress'" type="warning">服务进行中</el-tag>
              <el-tag v-else-if="need.order_status === 'pending_confirm'" type="primary">待居民确认</el-tag>
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
              <div v-if="Number(need.order_service_hours) > 0" class="flex items-center text-gray-600">
                <el-icon class="mr-2 text-gray-400"><Timer /></el-icon>
                <span>
                  提交服务时长：{{ need.order_service_hours }} 小时
                  <span v-if="need.order_status === 'completed'" class="text-green-600">
                    （已结算 {{ Number(need.order_service_hours) * 10 }} 积分）
                  </span>
                </span>
              </div>
            </div>
          </div>

          <!-- 接单后的进度：进行中 -> 待确认 -> 已完成 -->
          <div v-if="need.order_status" class="mb-6 px-2">
            <el-steps :active="getStepActive(need.order_status)" align-center>
              <el-step title="志愿者接单" />
              <el-step title="进行中" />
              <el-step title="待居民确认" />
              <el-step title="已完成" />
            </el-steps>
            <el-alert
              :title="getStatusHint(need)"
              :type="need.order_status === 'pending_confirm' ? 'warning' : need.order_status === 'completed' ? 'success' : 'info'"
              :closable="false"
              show-icon
              class="mt-4"
            />
          </div>

          <div class="flex justify-end gap-3" v-if="user?.role === 'volunteer' && need.status === 'pending'">
            <el-button type="primary" size="large" :loading="accepting" @click="handleAccept">
              我要接单
            </el-button>
          </div>
          <div v-else-if="user?.id === need.user_id && need.status === 'pending'" class="text-right">
            <el-tag type="info">等待志愿者接单</el-tag>
          </div>

          <!-- 志愿者：进行中可提交服务时长 -->
          <div
            v-else-if="user?.role === 'volunteer' && user?.id === need.order_volunteer_id && need.order_status === 'in_progress'"
            class="flex justify-end gap-3"
          >
            <el-button type="primary" size="large" @click="showSubmitDialog">提交服务时长</el-button>
          </div>

          <!-- 居民：待确认时确认或退回 -->
          <div
            v-else-if="user?.id === need.user_id && need.order_status === 'pending_confirm'"
            class="flex justify-end gap-3"
          >
            <el-button type="warning" size="large" plain :loading="processing" @click="handleReturn">退回</el-button>
            <el-button type="success" size="large" :loading="processing" @click="handleConfirm">确认完成</el-button>
          </div>
        </el-card>
      </template>
    </div>

    <!-- 志愿者提交服务时长 -->
    <el-dialog v-model="submitDialogVisible" title="提交服务时长" width="420px">
      <el-form label-width="100px">
        <el-form-item label="服务时长">
          <el-input-number v-model="serviceHours" :min="1" :max="12" :step="1" :precision="0" />
          <span class="ml-2 text-gray-500">小时（1~12 整数）</span>
        </el-form-item>
        <el-form-item label="预计积分">
          <span class="text-green-600 font-medium">{{ serviceHours * 10 }} 积分</span>
          <span class="ml-2 text-gray-400 text-xs">居民确认后到账</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="submitDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">提交，待居民确认</el-button>
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
const processing = ref(false)
const submitDialogVisible = ref(false)
const submitting = ref(false)
const serviceHours = ref(1)

const typeMap = {
  accompany: { name: '陪聊陪诊', color: 'blue' },
  shopping: { name: '代买代办', color: 'green' },
  repair: { name: '家电维修', color: 'orange' },
  housework: { name: '家政服务', color: 'purple' },
  other: { name: '其他帮助', color: 'gray' }
}

const getTypeName = (type) => typeMap[type]?.name || type
const getTypeColor = (type) => typeMap[type]?.color || 'info'

const getStepActive = (orderStatus) => {
  if (orderStatus === 'completed') return 4
  if (orderStatus === 'pending_confirm') return 3
  return 2
}

const getStatusHint = (detail) => {
  if (detail.order_status === 'completed') {
    return `服务已完成，按 ${detail.order_service_hours} 小时 × 10 分结算了 ${Number(detail.order_service_hours) * 10} 积分`
  }
  if (detail.order_status === 'pending_confirm') {
    return user.value?.id === detail.user_id
      ? `志愿者已提交 ${detail.order_service_hours} 小时服务时长，等待您确认；与实际不符可退回，志愿者可重新提交`
      : `已提交 ${detail.order_service_hours} 小时服务时长，等待居民确认，确认后积分才会到账`
  }
  if (detail.order_status === 'in_progress') {
    return user.value?.id === detail.order_volunteer_id && user.value?.role === 'volunteer'
      ? '服务进行中，完成后请提交 1~12 小时的服务时长'
      : '服务进行中，志愿者提交服务时长后将由居民确认'
  }
  return ''
}

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
    router.push('/orders')
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.response?.data?.message || '接单失败')
    }
  } finally {
    accepting.value = false
  }
}

const showSubmitDialog = () => {
  serviceHours.value = 1
  submitDialogVisible.value = true
}

const handleSubmit = async () => {
  try {
    submitting.value = true
    await api.put(`/orders/${need.value.order_id}/submit`, { service_hours: serviceHours.value })
    ElMessage.success('服务时长已提交，等待居民确认')
    submitDialogVisible.value = false
    await fetchNeed()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

const handleConfirm = async () => {
  try {
    await ElMessageBox.confirm(
      `确认志愿者本次服务时长为 ${need.value.order_service_hours} 小时吗？确认后将按每小时 10 分结算积分，且不可重复加分。`,
      '确认服务完成',
      {
        confirmButtonText: '确认完成',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    processing.value = true
    await api.put(`/orders/${need.value.order_id}/confirm`)
    ElMessage.success('已确认，服务完成')
    await fetchNeed()
    userStore.fetchUserInfo()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.response?.data?.message || '确认失败')
    }
  } finally {
    processing.value = false
  }
}

const handleReturn = async () => {
  try {
    await ElMessageBox.confirm(
      '确定退回本次服务时长申请吗？订单将回到进行中，志愿者可重新提交。',
      '退回服务时长',
      {
        confirmButtonText: '退回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    processing.value = true
    await api.put(`/orders/${need.value.order_id}/return`)
    ElMessage.success('已退回，订单回到进行中')
    await fetchNeed()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.response?.data?.message || '退回失败')
    }
  } finally {
    processing.value = false
  }
}

onMounted(() => {
  fetchNeed()
})
</script>
