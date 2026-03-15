
create table if not exists products (
  id serial primary key,
  name text not null,
  model text not null,
  category text not null default '',
  unit text not null default 'kg',
  price numeric(18,2) not null default 0,
  store_stock numeric(18,3) not null default 0,
  factory_stock numeric(18,3) not null default 0
);

create table if not exists customers (
  id serial primary key,
  name text not null,
  phone text default '',
  address text default '',
  opening_debt numeric(18,2) not null default 0
);

create table if not exists sales_orders (
  id serial primary key,
  order_no text not null unique,
  sale_date date not null,
  customer_id integer not null,
  customer_name text not null,
  payment_method text not null default 'cash',
  bank_name text not null default '现金',
  receive_type text not null default 'store',
  total_qty numeric(18,3) not null default 0,
  total_amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  unpaid_amount numeric(18,2) not null default 0,
  payment_status text not null default '欠款中',
  gtb_status text not null default '非GTB',
  remark text not null default '',
  deleted_at timestamp null
);

create table if not exists sales_order_items (
  id serial primary key,
  sales_order_id integer not null references sales_orders(id),
  product_id integer not null references products(id),
  product_name text not null,
  model text not null,
  source text not null default 'store',
  qty numeric(18,3) not null default 0,
  unit text not null default 'kg',
  unit_price numeric(18,2) not null default 0,
  amount numeric(18,2) not null default 0
);

create table if not exists repayments (
  id serial primary key,
  sales_order_id integer not null references sales_orders(id),
  customer_id integer not null,
  customer_name text not null,
  repay_date date not null default current_date,
  amount numeric(18,2) not null default 0,
  method text not null default 'bank',
  bank_name text not null default 'CB'
);

insert into products (name, model, category, unit, price, store_stock, factory_stock)
values
('浮球绳','10MM','绳类','kg',3200,180,500),
('浮球绳','12MM','绳类','kg',3600,120,350),
('海洋浮球','A-01','浮球','个',4500,90,200),
('配件扣','C-02','配件','个',800,600,1000)
on conflict do nothing;

insert into customers (name, phone, address, opening_debt)
values
('AA渔业','09xxxxxxx','Yangon',120000),
('Ocean Star','09yyyyyyy','Mawlamyine',0),
('Golden Fishery','09zzzzzzz','Pathein',300000)
on conflict do nothing;
