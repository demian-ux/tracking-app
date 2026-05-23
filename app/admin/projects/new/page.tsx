import { createClient } from '@/lib/supabase/server'
import { NewProjectForm } from '@/components/admin/NewProjectForm'
import { PageHead } from '@/components/ui/PageHead'

export default async function NewProjectPage() {
  const supabase = await createClient()
  const { data: clients } = await supabase.from('clients').select('id, name').order('name')

  return (
    <div className="max-w-lg">
      <PageHead title="New project" />
      <NewProjectForm clients={clients ?? []} />
    </div>
  )
}
