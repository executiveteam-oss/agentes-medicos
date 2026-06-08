import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkReadPermission } from '@/lib/actions-helpers'
import { BulkClassifyList } from '@/components/dashboard/res256/bulk-classify-list'

export default async function Res256CategoriesPage() {
  const clinicId = await checkReadPermission('whatsapp')

  const { data: types } = await supabaseAdmin
    .from('consultation_types')
    .select('id, name, doctor_id, res256_category, doctor:doctors(name)')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Clasificación Res-256</h1>
      <p style={{ color: 'var(--v2-text-subtle)', marginTop: 8, fontSize: 14 }}>
        Clasifica cada tipo de consulta para que aparezca en el reporte MinSalud. Las sugerencias en gris son heurísticas — revisa cada una antes de aplicar.
      </p>
      <div style={{ marginTop: 20 }}>
        <BulkClassifyList types={(types ?? []) as unknown as Array<{ id: string; name: string; doctor_id: string; res256_category: string | null; doctor: { name: string } | null }>} />
      </div>
    </div>
  )
}
