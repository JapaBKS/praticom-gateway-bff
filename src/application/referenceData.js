// Dados de referência (condomínio, unidades e moradores).
// Esses cadastros pertencem a um domínio que NÃO faz parte dos dois microsserviços deste trabalho
// (no Praticom original eram as tabelas units/residents). O BFF os fornece como dados fixos para
// que as telas de Mercadinho e Financeiro continuem funcionando sem alteração.

export const condominiums = [
  {
    id: 1,
    name: 'Condomínio Alpha Praticom',
    status: 'ACTIVE',
    address: 'Rua das Acácias, 100',
    city: 'São Paulo',
    state: 'SP',
    blocks_count: 2,
    units_count: 6
  }
];

export const units = [
  { id: 1, block: 'Bloco A', number: '101' },
  { id: 2, block: 'Bloco A', number: '102' },
  { id: 3, block: 'Bloco A', number: '201' },
  { id: 4, block: 'Bloco B', number: '101' },
  { id: 5, block: 'Bloco B', number: '102' },
  { id: 6, block: 'Bloco B', number: '201' }
];

export const residents = [
  { id: 1, name: 'Ana Souza', unit_id: 1 },
  { id: 2, name: 'Bruno Lima', unit_id: 2 },
  { id: 3, name: 'Carla Mendes', unit_id: 3 },
  { id: 4, name: 'Diego Rocha', unit_id: 4 },
  { id: 5, name: 'Elisa Nunes', unit_id: 5 },
  { id: 6, name: 'Fábio Costa', unit_id: 6 }
];

// Módulos do Praticom original; só dashboard, financeiro e mercadinho existem nesta versão.
export const modules = [
  { module_key: 'dashboard', enabled: true },
  { module_key: 'financial', enabled: true },
  { module_key: 'market', enabled: true },
  { module_key: 'deliveries', enabled: false },
  { module_key: 'access', enabled: false },
  { module_key: 'reservations', enabled: false }
];
