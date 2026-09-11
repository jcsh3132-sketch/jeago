import os
import uuid
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_migrate import Migrate
from sqlalchemy import func, text
from models import db, Item, Transaction, Category, Partner

MANAGERS = ['김채희', '이승철', '이무현', '장수민', '황진철']
DEFAULT_MAIN_CATEGORIES = ['컬러 복합기', '흑백 복합기', '컬러 소형 복합기', '흑백 소형 프린터']
UNCLASSIFIED_MAIN = '미분류'


def ensure_schema():
    cols = [r[1] for r in db.session.execute(text('PRAGMA table_info(category)')).fetchall()]
    if 'parent_id' not in cols:
        db.session.execute(text('ALTER TABLE category ADD COLUMN parent_id INTEGER'))
    if 'display_name' not in cols:
        db.session.execute(text('ALTER TABLE category ADD COLUMN display_name VARCHAR(80)'))
    db.session.execute(text('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)'))

    item_cols = [r[1] for r in db.session.execute(text('PRAGMA table_info(item)')).fetchall()]
    if 'low_stock_threshold' not in item_cols:
        db.session.execute(text('ALTER TABLE item ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 5'))

    # 최신 DB에는 이미 존재하지만, 예전 DB로 실행해도 출고업체 저장이 가능하도록 보완합니다.
    tx_cols = [r[1] for r in db.session.execute(text('PRAGMA table_info(\"transaction\")')).fetchall()]
    if 'customer_name' not in tx_cols:
        db.session.execute(text('ALTER TABLE \"transaction\" ADD COLUMN customer_name VARCHAR(120)'))
    db.session.commit()


def meta_get(key):
    row = db.session.execute(text('SELECT value FROM app_meta WHERE key=:k'), {'k': key}).fetchone()
    return row[0] if row else None


def meta_set(key, value='1'):
    db.session.execute(text('INSERT OR REPLACE INTO app_meta(key,value) VALUES (:k,:v)'), {'k': key, 'v': value})
    db.session.commit()


def unique_key(prefix='cat'):
    return f'{prefix}_{uuid.uuid4().hex[:14]}'


def unique_child_key(parent_id):
    return f'child_{parent_id}_{uuid.uuid4().hex[:12]}'


def infer_child_label(parent_label):
    if '드럼' in parent_label:
        return '드럼 모델'
    if '토너' in parent_label:
        return '토너 모델'
    if '자재' in parent_label:
        return '자재 모델'
    return '장비 모델'


def repair_hierarchy_from_items():
    item_keys = [row[0] for row in db.session.query(Item.category).distinct().all()
                 if row[0] and str(row[0]).strip()]
    if not item_keys:
        return
    valid_category_keys = {c.name for c in Category.query.all()}
    missing = [key for key in item_keys if key not in valid_category_keys]
    for legacy_key in missing:
        parent = Category.query.filter_by(name=legacy_key, parent_id=None).first()
        if parent is None:
            internal_parent_key = legacy_key if Category.query.filter_by(name=legacy_key).first() is None else unique_key('parent')
            parent = Category(name=internal_parent_key, display_name=legacy_key, parent_id=None)
            db.session.add(parent); db.session.flush()
        child = Category.query.filter_by(parent_id=parent.id).order_by(Category.id.asc()).first()
        if child is None:
            child = Category(name=unique_child_key(parent.id), display_name=infer_child_label(parent.label), parent_id=parent.id)
            db.session.add(child); db.session.flush()
        Item.query.filter_by(category=legacy_key).update({'category': child.name}, synchronize_session=False)
    db.session.commit()


def migrate_hierarchy_v2():
    if meta_get('category_hierarchy_v2') == '1':
        return
    cats = Category.query.order_by(Category.id.asc()).all()
    for c in cats:
        if not c.display_name:
            c.display_name = c.name
    db.session.commit()
    parents = Category.query.filter(Category.parent_id.is_(None)).all()
    material = next((p for p in parents if p.label == '자재'), None)
    if material:
        old_children = Category.query.filter_by(parent_id=material.id).order_by(Category.id.asc()).all()
        for old in old_children:
            old_visible = old.label
            old.parent_id = None
            old.display_name = old_visible
            db.session.flush()
            child = Category(name=unique_child_key(old.id), display_name=infer_child_label(old_visible), parent_id=old.id)
            db.session.add(child); db.session.flush()
            Item.query.filter_by(category=old.name).update({'category': child.name}, synchronize_session=False)
        direct = Item.query.filter_by(category=material.name).count()
        if direct:
            p = Category(name=unique_key('parent'), display_name='기타 자재', parent_id=None)
            db.session.add(p); db.session.flush()
            c = Category(name=unique_child_key(p.id), display_name='장비 모델', parent_id=p.id)
            db.session.add(c); db.session.flush()
            Item.query.filter_by(category=material.name).update({'category': c.name}, synchronize_session=False)
        db.session.delete(material); db.session.commit()
    elif cats and not any(c.parent_id is not None for c in cats):
        for p in Category.query.filter(Category.parent_id.is_(None)).all():
            child = Category(name=unique_child_key(p.id), display_name=infer_child_label(p.label), parent_id=p.id)
            db.session.add(child); db.session.flush()
            Item.query.filter_by(category=p.name).update({'category': child.name}, synchronize_session=False)
        db.session.commit()
    meta_set('category_hierarchy_v2', '1')


def migrate_hierarchy_v3():
    """Add a new top level: main category -> device model -> item category -> inventory item."""
    if meta_get('category_hierarchy_v3') == '1':
        return

    # Existing roots are the device-model groups from v2. Keep their children/items intact.
    old_roots = Category.query.filter(Category.parent_id.is_(None)).order_by(Category.id.asc()).all()
    main_nodes = {}
    for label in DEFAULT_MAIN_CATEGORIES + [UNCLASSIFIED_MAIN]:
        node = Category(name=unique_key('main'), display_name=label, parent_id=None)
        db.session.add(node); db.session.flush()
        main_nodes[label] = node

    unclassified = main_nodes[UNCLASSIFIED_MAIN]
    for old in old_roots:
        # Avoid wrapping a partially created v3 main node if a previous startup stopped mid-transaction.
        if old.id in {x.id for x in main_nodes.values()}:
            continue
        old.parent_id = unclassified.id
    db.session.commit()
    meta_set('category_hierarchy_v3', '1')


def create_app():
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///inventory.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.environ.get('INVENTORY_SECRET_KEY', 'inventory-internal-local')
    db.init_app(app); Migrate(app, db)

    with app.app_context():
        db.create_all(); ensure_schema(); migrate_hierarchy_v2(); repair_hierarchy_from_items(); migrate_hierarchy_v3()

    def mains():
        return Category.query.filter(Category.parent_id.is_(None)).order_by(Category.id.asc()).all()

    def devices():
        main_ids = [m.id for m in mains()]
        if not main_ids:
            return []
        return Category.query.filter(Category.parent_id.in_(main_ids)).order_by(Category.id.asc()).all()

    def leaves():
        device_ids = [d.id for d in devices()]
        if not device_ids:
            return []
        return Category.query.filter(Category.parent_id.in_(device_ids)).order_by(Category.id.asc()).all()

    def main_by_id(node_id):
        return Category.query.filter(Category.id == node_id, Category.parent_id.is_(None)).first()

    def device_by_id(node_id):
        if not node_id:
            return None
        d = Category.query.get(node_id)
        return d if d and d.parent and d.parent.parent_id is None else None

    def leaf_by_key(key):
        c = Category.query.filter_by(name=key).first()
        return c if c and c.parent and c.parent.parent and c.parent.parent.parent_id is None else None

    def leaf_keys_for_device(device_id):
        return [c.name for c in Category.query.filter_by(parent_id=device_id).all()]

    def leaf_keys_for_main(main_id):
        device_ids = [d.id for d in Category.query.filter_by(parent_id=main_id).all()]
        if not device_ids:
            return []
        return [c.name for c in Category.query.filter(Category.parent_id.in_(device_ids)).all()]

    def hierarchy_data():
        ms = mains(); ds = devices(); ls = leaves()
        ds_by_main = {m.id: [] for m in ms}
        ls_by_device = {d.id: [] for d in ds}
        for d in ds: ds_by_main.setdefault(d.parent_id, []).append(d)
        for c in ls: ls_by_device.setdefault(c.parent_id, []).append(c)
        return [(m, [(d, ls_by_device.get(d.id, [])) for d in ds_by_main.get(m.id, [])]) for m in ms]

    def tree_data():
        item_map = {}
        for i in Item.query.order_by(Item.name.asc()).all():
            item_map.setdefault(i.category, []).append(i)
        return [(m, [(d, [(c, item_map.get(c.name, [])) for c in cs]) for d, cs in device_rows])
                for m, device_rows in hierarchy_data()]

    def item_context_maps():
        ls = leaves()
        device_map = {d.id: d for d in devices()}
        main_map = {m.id: m for m in mains()}
        leaf_label = {}; device_label = {}; main_label = {}
        for c in ls:
            d = device_map.get(c.parent_id)
            m = main_map.get(d.parent_id) if d else None
            leaf_label[c.name] = c.label
            device_label[c.name] = d.label if d else ''
            main_label[c.name] = m.label if m else ''
        return leaf_label, device_label, main_label

    @app.after_request
    def headers(resp):
        resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
        resp.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
        return resp

    @app.route('/health')
    def health(): return {'status': 'ok'}, 200

    @app.route('/')
    def index():
        selected_main = request.args.get('main', type=int)
        selected_device = request.args.get('device', type=int)
        selected_category = request.args.get('category', '')
        selected_item_id = request.args.get('item', type=int)
        stock_filter = request.args.get('stock', 'all') if request.args.get('stock', 'all') in {'all','in_stock','low','out'} else 'all'

        scope_keys = None
        scope_label = ''
        leaf_obj = leaf_by_key(selected_category) if selected_category else None
        device_obj = device_by_id(selected_device) if selected_device else None
        main_obj = main_by_id(selected_main) if selected_main else None

        if leaf_obj:
            scope_keys = [leaf_obj.name]; scope_label = leaf_obj.label
            selected_device = leaf_obj.parent_id
            selected_main = leaf_obj.parent.parent_id
        elif device_obj:
            scope_keys = leaf_keys_for_device(device_obj.id); scope_label = device_obj.label
            selected_main = device_obj.parent_id; selected_category = ''
        elif main_obj:
            scope_keys = leaf_keys_for_main(main_obj.id); scope_label = main_obj.label
            selected_device = None; selected_category = ''
        else:
            selected_main = selected_device = None; selected_category = ''

        q = Item.query
        if scope_keys is not None:
            q = q.filter(Item.category.in_(scope_keys)) if scope_keys else q.filter(text('1=0'))
        scoped = q.order_by(Item.name.asc()).all()
        stats = {
            'model_count': len(scoped), 'total_qty': sum(i.quantity for i in scoped),
            'in_stock_count': sum(i.quantity > 0 for i in scoped),
            'low_count': sum(1 <= i.quantity <= i.low_stock_threshold for i in scoped),
            'out_count': sum(i.quantity == 0 for i in scoped)
        }
        if stock_filter == 'in_stock': items = [i for i in scoped if i.quantity > 0]
        elif stock_filter == 'low': items = [i for i in scoped if 1 <= i.quantity <= i.low_stock_threshold]
        elif stock_filter == 'out': items = [i for i in scoped if i.quantity == 0]
        else: items = scoped

        leaf_label, device_label, main_label = item_context_maps()
        return render_template('index.html', items=items, stats=stats, stock_filter=stock_filter,
            selected_main=selected_main, selected_device=selected_device, selected_category=selected_category,
            selected_scope_label=scope_label, selected_item_id=selected_item_id,
            category_tree=tree_data(), hierarchy=hierarchy_data(), leaves=leaves(),
            category_label_map=leaf_label, category_device_label_map=device_label, category_main_label_map=main_label)

    @app.route('/add', methods=['GET','POST'])
    def add_item():
        leaf_list = leaves(); valid = {c.name for c in leaf_list}
        if request.method == 'POST':
            cat = request.form.get('category', '')
            if cat not in valid:
                flash('품목 카테고리를 선택하세요.'); return redirect(url_for('add_item'))
            item = Item(name=request.form['name'].strip(), manager=request.form['manager'], quantity=0, category=cat)
            db.session.add(item); db.session.commit(); flash('새 모델이 추가되었습니다.')
            return redirect(url_for('index', category=cat, item=item.id))
        sel = request.args.get('category', ''); sel = sel if sel in valid else ''
        return render_template('add_item.html', managers=MANAGERS, categories=leaf_list, hierarchy=hierarchy_data(), selected_category=sel)

    @app.route('/edit/<int:id>', methods=['GET','POST'])
    def edit_item(id):
        item = Item.query.get_or_404(id); leaf_list = leaves(); valid = {c.name for c in leaf_list}
        if request.method == 'POST':
            cat = request.form.get('category', item.category)
            if cat not in valid:
                flash('품목 카테고리를 선택하세요.'); return redirect(url_for('edit_item', id=id))
            item.name = request.form['name'].strip(); item.manager = request.form['manager']; item.category = cat
            db.session.commit(); flash('모델이 수정되었습니다.')
            return redirect(url_for('index', category=cat, item=id))
        return render_template('edit_item.html', item=item, managers=MANAGERS, categories=leaf_list, hierarchy=hierarchy_data())

    @app.route('/item/<int:id>/low-stock-threshold', methods=['POST'])
    def update_low_stock_threshold(id):
        item = Item.query.get_or_404(id)
        raw = request.form.get('threshold')
        if raw is None and request.is_json:
            raw = (request.get_json(silent=True) or {}).get('threshold')
        try:
            threshold = int(raw)
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'message': '올바른 수량을 입력하세요.'}), 400
        if threshold < 0 or threshold > 999:
            return jsonify({'ok': False, 'message': '재고 부족 기준은 0~999 사이로 설정하세요.'}), 400
        item.low_stock_threshold = threshold
        db.session.commit()
        if item.quantity == 0:
            state, label = 'out', '재고 없음'
        elif item.quantity <= threshold:
            state, label = 'low', '부족'
        else:
            state, label = 'good', '정상'
        return jsonify({'ok': True, 'threshold': threshold, 'state': state, 'label': label})

    @app.route('/inbound/<int:id>', methods=['GET','POST'])
    def inbound(id):
        item = Item.query.get_or_404(id)
        if request.method == 'POST':
            qty = int(request.form['quantity']); manager = request.form['manager']
            db.session.add(Transaction(item_id=id, quantity=qty, transaction_type='입고', manager=manager)); item.quantity += qty
            db.session.commit(); return redirect(url_for('index', category=item.category, item=id))
        return render_template('inbound.html', item=item, managers=MANAGERS)

    @app.route('/outbound/<int:id>', methods=['GET','POST'])
    def outbound(id):
        item = Item.query.get_or_404(id)
        partners = Partner.query.order_by(Partner.name.asc()).all()
        if request.method == 'POST':
            qty = int(request.form['quantity']); manager = request.form['manager']
            customer_name = (request.form.get('customer_name') or '').strip()
            if qty > item.quantity:
                flash('출고 수량이 현재 재고보다 많습니다.'); return redirect(url_for('outbound', id=id))
            if not customer_name:
                flash('출고업체를 입력하거나 선택하세요.'); return render_template('outbound.html', item=item, managers=MANAGERS, partners=partners)
            db.session.add(Transaction(item_id=id, quantity=qty, transaction_type='출고', manager=manager, customer_name=customer_name)); item.quantity -= qty
            db.session.commit(); return redirect(url_for('index', category=item.category, item=id))
        return render_template('outbound.html', item=item, managers=MANAGERS, partners=partners)

    @app.route('/history/<int:id>')
    def history(id):
        item = Item.query.get_or_404(id); tx = Transaction.query.filter_by(item_id=id).order_by(Transaction.date.asc()).all(); rem=[]; qty=0
        for t in tx:
            qty += t.quantity if t.transaction_type == '입고' else -t.quantity; rem.append(qty)
        return render_template('history.html', item=item, zipped=list(zip(reversed(tx), reversed(rem))))

    @app.route('/delete/<int:id>', methods=['POST'])
    def delete_item(id):
        item = Item.query.get_or_404(id); cat = item.category
        Transaction.query.filter_by(item_id=id).delete(); db.session.delete(item); db.session.commit()
        return redirect(url_for('index', category=cat))

    @app.route('/update_category', methods=['POST'])
    def update_category():
        cat = request.form.get('category'); item = Item.query.get_or_404(request.form.get('item_id'))
        if not leaf_by_key(cat):
            flash('존재하지 않는 품목 카테고리입니다.'); return redirect(url_for('index'))
        item.category = cat; db.session.commit(); return redirect(url_for('index', category=cat, item=item.id))


    @app.route('/transactions')
    def transaction_history_all():
        q = (request.args.get('q') or '').strip()
        tx_type = (request.args.get('type') or 'all').strip()
        query = Transaction.query.join(Item, Transaction.item_id == Item.id)
        if q:
            like = f'%{q}%'
            query = query.filter(db.or_(Item.name.ilike(like), Transaction.manager.ilike(like), Transaction.customer_name.ilike(like)))
        if tx_type in {'입고', '출고'}:
            query = query.filter(Transaction.transaction_type == tx_type)
        rows = query.order_by(Transaction.date.desc(), Transaction.id.desc()).all()
        item_ids = {t.item_id for t in rows}
        item_map = {i.id: i for i in Item.query.filter(Item.id.in_(item_ids)).all()} if item_ids else {}
        return render_template('transactions.html', rows=rows, item_map=item_map, q=q, tx_type=tx_type)

    @app.route('/partners')
    def partners():
        q = (request.args.get('q') or '').strip()
        query = Partner.query
        if q:
            like = f'%{q}%'
            query = query.filter(db.or_(Partner.name.ilike(like), Partner.contact_person.ilike(like), Partner.phone.ilike(like)))
        return render_template('partners.html', partners=query.order_by(Partner.name.asc()).all(), q=q)

    @app.route('/partners/add', methods=['POST'])
    def add_partner():
        name = (request.form.get('name') or '').strip()
        if not name:
            flash('거래처명을 입력하세요.')
            return redirect(url_for('partners'))
        db.session.add(Partner(
            name=name,
            contact_person=(request.form.get('contact_person') or '').strip(),
            phone=(request.form.get('phone') or '').strip(),
            note=(request.form.get('note') or '').strip()
        ))
        db.session.commit()
        flash('거래처를 추가했습니다.')
        return redirect(url_for('partners'))

    @app.route('/partners/edit/<int:id>', methods=['POST'])
    def edit_partner(id):
        partner = Partner.query.get_or_404(id)
        name = (request.form.get('name') or '').strip()
        if not name:
            flash('거래처명을 입력하세요.')
            return redirect(url_for('partners'))
        partner.name = name
        partner.contact_person = (request.form.get('contact_person') or '').strip()
        partner.phone = (request.form.get('phone') or '').strip()
        partner.note = (request.form.get('note') or '').strip()
        db.session.commit()
        flash('거래처 정보를 수정했습니다.')
        return redirect(url_for('partners'))

    @app.route('/partners/delete/<int:id>', methods=['POST'])
    def delete_partner(id):
        partner = Partner.query.get_or_404(id)
        db.session.delete(partner)
        db.session.commit()
        flash('거래처를 삭제했습니다.')
        return redirect(url_for('partners'))

    @app.route('/categories')
    def manage_categories():
        count_map = dict(db.session.query(Item.category, func.count(Item.id)).group_by(Item.category).all())
        item_map = {}
        for item in Item.query.order_by(Item.name.asc()).all(): item_map.setdefault(item.category, []).append(item)
        return render_template('categories.html', hierarchy=hierarchy_data(), count_map=count_map, item_map=item_map,
                               default_main_categories=DEFAULT_MAIN_CATEGORIES)

    @app.route('/categories/item/delete/<int:item_id>', methods=['POST'])
    def delete_item_from_categories(item_id):
        item = Item.query.get_or_404(item_id); item_name = item.name
        Transaction.query.filter_by(item_id=item_id).delete(synchronize_session=False); db.session.delete(item); db.session.commit()
        flash(f'모델 "{item_name}"을(를) 삭제했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/main/add', methods=['POST'])
    def add_main_category():
        label = request.form.get('name','').strip()
        if not label:
            flash('대분류 이름을 입력하세요.'); return redirect(url_for('manage_categories'))
        if any(m.label.lower() == label.lower() for m in mains()):
            flash('같은 대분류가 이미 있습니다.'); return redirect(url_for('manage_categories'))
        db.session.add(Category(name=unique_key('main'), display_name=label, parent_id=None)); db.session.commit()
        flash('대분류를 추가했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/device/add', methods=['POST'])
    def add_device_category():
        label = request.form.get('name','').strip(); main_id = request.form.get('main_id', type=int); main = main_by_id(main_id)
        if not main or not label:
            flash('대분류와 장비 모델명을 확인하세요.'); return redirect(url_for('manage_categories'))
        siblings = Category.query.filter_by(parent_id=main.id).all()
        if any(x.label.lower() == label.lower() for x in siblings):
            flash('해당 대분류에 같은 장비 모델이 이미 있습니다.'); return redirect(url_for('manage_categories'))
        db.session.add(Category(name=unique_key('device'), display_name=label, parent_id=main.id)); db.session.commit()
        flash('장비 모델을 추가했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/leaf/add', methods=['POST'])
    def add_leaf_category():
        label = request.form.get('name','').strip(); device_id = request.form.get('device_id', type=int); device = device_by_id(device_id)
        if not device or not label:
            flash('장비 모델과 품목 카테고리 이름을 확인하세요.'); return redirect(url_for('manage_categories'))
        siblings = Category.query.filter_by(parent_id=device.id).all()
        if any(x.label.lower() == label.lower() for x in siblings):
            flash('해당 장비에 같은 품목 카테고리가 이미 있습니다.'); return redirect(url_for('manage_categories'))
        db.session.add(Category(name=unique_key('leaf'), display_name=label, parent_id=device.id)); db.session.commit()
        flash('품목 카테고리를 추가했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/main/rename/<int:id>', methods=['POST'])
    def rename_main(id):
        node = main_by_id(id)
        if not node: return redirect(url_for('manage_categories'))
        label = request.form.get('name','').strip()
        if not label:
            flash('새 이름을 입력하세요.'); return redirect(url_for('manage_categories'))
        if any(x.id != node.id and x.label.lower() == label.lower() for x in mains()):
            flash('같은 대분류가 이미 있습니다.'); return redirect(url_for('manage_categories'))
        node.display_name = label; db.session.commit(); flash('대분류 이름을 변경했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/device/rename/<int:id>', methods=['POST'])
    def rename_device(id):
        d = device_by_id(id)
        if not d: return redirect(url_for('manage_categories'))
        label = request.form.get('name','').strip()
        if not label:
            flash('새 이름을 입력하세요.'); return redirect(url_for('manage_categories'))
        if any(x.id != d.id and x.label.lower() == label.lower() for x in Category.query.filter_by(parent_id=d.parent_id).all()):
            flash('같은 장비 모델이 이미 있습니다.'); return redirect(url_for('manage_categories'))
        d.display_name = label; db.session.commit(); flash('장비 모델명을 변경했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/leaf/rename/<int:id>', methods=['POST'])
    def rename_leaf(id):
        c = Category.query.get_or_404(id)
        if not c.parent or not c.parent.parent: return redirect(url_for('manage_categories'))
        label = request.form.get('name','').strip()
        if not label:
            flash('새 이름을 입력하세요.'); return redirect(url_for('manage_categories'))
        if any(x.id != c.id and x.label.lower() == label.lower() for x in Category.query.filter_by(parent_id=c.parent_id).all()):
            flash('같은 품목 카테고리가 이미 있습니다.'); return redirect(url_for('manage_categories'))
        c.display_name = label; db.session.commit(); flash('품목 카테고리 이름을 변경했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/device/move/<int:id>', methods=['POST'])
    def move_device(id):
        d = device_by_id(id); target = main_by_id(request.form.get('main_id', type=int))
        if not d or not target:
            flash('이동할 대분류를 선택하세요.'); return redirect(url_for('manage_categories'))
        if d.parent_id == target.id:
            flash('이미 해당 대분류에 속해 있습니다.'); return redirect(url_for('manage_categories'))
        if any(x.label.lower() == d.label.lower() for x in Category.query.filter_by(parent_id=target.id).all()):
            flash('대상 대분류에 같은 장비 모델이 이미 있습니다.'); return redirect(url_for('manage_categories'))
        d.parent_id = target.id; db.session.commit(); flash(f'"{d.label}"을(를) "{target.label}"로 이동했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/leaf/move/<int:id>', methods=['POST'])
    def move_leaf(id):
        c = Category.query.get_or_404(id); target = device_by_id(request.form.get('device_id', type=int))
        if not c.parent or not c.parent.parent or not target:
            flash('이동할 장비 모델을 선택하세요.'); return redirect(url_for('manage_categories'))
        if c.parent_id == target.id:
            flash('이미 해당 장비 모델에 속해 있습니다.'); return redirect(url_for('manage_categories'))
        if any(x.label.lower() == c.label.lower() for x in Category.query.filter_by(parent_id=target.id).all()):
            flash('대상 장비에 같은 품목 카테고리가 이미 있습니다.'); return redirect(url_for('manage_categories'))
        c.parent_id = target.id; db.session.commit(); flash(f'"{c.label}"을(를) "{target.label}"로 이동했습니다.'); return redirect(url_for('manage_categories'))

    def delete_items(keys):
        items = Item.query.filter(Item.category.in_(keys)).all() if keys else []; ids = [i.id for i in items]
        if ids:
            Transaction.query.filter(Transaction.item_id.in_(ids)).delete(synchronize_session=False)
            Item.query.filter(Item.id.in_(ids)).delete(synchronize_session=False)
        return len(items)

    @app.route('/categories/main/delete/<int:id>', methods=['POST'])
    def delete_main(id):
        m = main_by_id(id)
        if not m: return redirect(url_for('manage_categories'))
        if Category.query.filter_by(parent_id=m.id).count():
            flash('장비 모델이 포함된 대분류는 바로 삭제할 수 없습니다. 먼저 장비 모델을 다른 대분류로 이동하거나 삭제하세요.')
            return redirect(url_for('manage_categories'))
        label = m.label; db.session.delete(m); db.session.commit(); flash(f'대분류 "{label}"을(를) 삭제했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/device/delete/<int:id>', methods=['POST'])
    def delete_device(id):
        d = device_by_id(id)
        if not d: return redirect(url_for('manage_categories'))
        leafs = Category.query.filter_by(parent_id=d.id).all(); n = delete_items([c.name for c in leafs]); label = d.label
        for c in leafs: db.session.delete(c)
        db.session.delete(d); db.session.commit(); flash(f'장비 "{label}"과 포함 모델 {n}개를 삭제했습니다.'); return redirect(url_for('manage_categories'))

    @app.route('/categories/leaf/delete/<int:id>', methods=['POST'])
    def delete_leaf(id):
        c = Category.query.get_or_404(id)
        if not c.parent or not c.parent.parent: return redirect(url_for('manage_categories'))
        n = delete_items([c.name]); label = c.label; db.session.delete(c); db.session.commit()
        flash(f'품목 카테고리 "{label}"과 포함 모델 {n}개를 삭제했습니다.'); return redirect(url_for('manage_categories'))

    return app

app = create_app()
if __name__ == '__main__':
    host = os.environ.get('INVENTORY_BIND_HOST', '0.0.0.0'); port = int(os.environ.get('INVENTORY_PORT', '5000'))
    try:
        from waitress import serve
        print(f'[Inventory] Waitress server: http://{host}:{port}'); serve(app, host=host, port=port, threads=8)
    except ImportError:
        app.run(debug=False, host=host, port=port)
