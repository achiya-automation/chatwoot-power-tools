# איחוד blobs כפולים ב-ActiveStorage — חוסך אחסון בלי לאבד קבצים.
#
# הרעיון: כשאותו קובץ בדיוק (checksum + byte_size זהים) הועלה כמה פעמים,
# כל עותק הוא blob נפרד עם קובץ נפרד על הדיסק. הסקריפט משאיר blob אחד
# ומפנה את כל ה-attachments אליו, ואז מוחק את היתומים.
#
# בטיחות:
#   • דדופ רק בתוך אותו חשבון — קבצים לא נודדים בין לקוחות.
#   • FK על active_storage_attachments.blob_id מונע מחיקת blob שעדיין בשימוש.
#   • ברירת המחדל היא dry-run. הרצה אמיתית: APPLY=1
#
# הרצה:  rails runner /tmp/dedupe_blobs.rb        (dry-run)
#        APPLY=1 rails runner /tmp/dedupe_blobs.rb  (ביצוע)

APPLY = ENV['APPLY'] == '1'
puts APPLY ? "🔴 מצב ביצוע — שינויים ייכתבו" : "🔵 dry-run — לא ייכתב דבר (APPLY=1 לביצוע)"
puts

groups = ActiveRecord::Base.connection.select_all(<<~SQL).to_a
  SELECT a.account_id,
         b.checksum,
         b.byte_size,
         COUNT(DISTINCT b.id)                AS copies,
         MIN(b.id)                           AS keeper_id,
         string_agg(DISTINCT b.id::text, ',') AS blob_ids
  FROM active_storage_attachments asa
  JOIN active_storage_blobs b ON b.id = asa.blob_id
  JOIN attachments a          ON a.id = asa.record_id
  WHERE asa.record_type = 'Attachment'
  GROUP BY a.account_id, b.checksum, b.byte_size
  HAVING COUNT(DISTINCT b.id) > 1
SQL

if groups.empty?
  puts "אין כפילויות — אין מה לעשות."
  exit
end

names   = Account.pluck(:id, :name).to_h
per_acc = Hash.new { |h, k| h[k] = { freed: 0, blobs: 0 } }
total_freed = 0
total_blobs = 0
errors = []

groups.each do |g|
  # string_agg מחזיר "12,34,56" — לא מערך Ruby. פיצול מפורש, אחרת כל קבוצה
  # מצטמצמת ל-blob אחד וה-dedupe נראה קטן בהרבה ממה שהוא.
  ids = g['blob_ids'].to_s.split(',').map(&:to_i).reject(&:zero?).uniq
  keeper = g['keeper_id'].to_i
  losers = ids - [keeper]
  next if losers.empty?

  # ודא שה-keeper באמת קיים ותקין לפני שמפנים אליו הכול
  unless ActiveStorage::Blob.exists?(id: keeper)
    errors << "keeper #{keeper} לא קיים — דילוג על checksum #{g['checksum'].to_s[0, 10]}"
    next
  end

  freed = g['byte_size'].to_i * losers.size
  per_acc[g['account_id']][:freed] += freed
  per_acc[g['account_id']][:blobs] += losers.size
  total_freed += freed
  total_blobs += losers.size

  next unless APPLY

  begin
    ActiveRecord::Base.transaction do
      # מפנים כל attachment שמצביע ל-blob מיותר אל ה-keeper
      ActiveStorage::Attachment.where(blob_id: losers).update_all(blob_id: keeper)
    end
    # מחיקה מחוץ לטרנזקציה: purge ניגש לאחסון, ואסור לו לרוץ בתוך transaction
    ActiveStorage::Blob.where(id: losers).find_each do |b|
      b.purge # FK יעצור אותו אם בטעות נשאר מצביע — ואז הקובץ פשוט נשאר
    rescue StandardError => e
      errors << "purge blob #{b.id}: #{e.class}"
    end
  rescue StandardError => e
    errors << "group #{g['checksum'].to_s[0, 10]}: #{e.class} #{e.message[0, 80]}"
  end
end

puts "=== חיסכון לפי חשבון ==="
per_acc.sort_by { |_, v| -v[:freed] }.each do |acc, v|
  puts format("  acct %-3s %-24s %6.2f GB  (%s blobs מיותרים)",
              acc, names[acc].to_s[0, 24], v[:freed].to_f / 1024**3, v[:blobs])
end
puts format("\n=== סה\"כ: %.2f GB ב-%s blobs, %s קבוצות ===",
            total_freed.to_f / 1024**3, total_blobs, groups.size)

if errors.any?
  puts "\n⚠️ שגיאות (#{errors.size}):"
  errors.first(10).each { |e| puts "  #{e}" }
end

puts APPLY ? "\n✅ בוצע." : "\n(dry-run — כלום לא שונה)"
