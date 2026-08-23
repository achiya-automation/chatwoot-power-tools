def label_title(raw)
  t = raw.to_s.gsub(/[‎‏‪-‮⁦-⁩]/, '')
       .gsub(/[^\p{L}\p{N}\s_-]/, '')
       .strip.squeeze(' ').tr(' ', '-').gsub(/-+/, '-').gsub(/\A-|-\z/, '')
  t.empty? ? nil : t
end
cases = [["‏לא נקראו", 'לא-נקראו'], ['מעקב', 'מעקב'], ['משתמשים מנויים✅', 'משתמשים-מנויים'],
         ['תמיכה ⚙️', 'תמיכה'], ['מחקר לקוח', 'מחקר-לקוח'], ['מכירות 💰', 'מכירות'],
         ['תקלות לטיפול ⚙️', 'תקלות-לטיפול'], ['💰💰', nil], ['', nil]]
bad = cases.reject { |i, e| a = label_title(i); warn("FAIL #{i.inspect} => #{a.inspect} != #{e.inspect}") unless a == e; a == e }
raise 'label title regressed' unless bad.empty?
puts "ok — #{cases.size} label-title assertions passed"
