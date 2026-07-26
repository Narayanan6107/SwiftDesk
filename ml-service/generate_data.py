import json
import random

CATEGORIES = ["Billing", "Technical", "Account", "Delivery", "Other"]
PRIORITIES = ["Low", "Medium", "High", "Critical"]

def gen_billing():
    templates = [
        ("Invoice not received", "I haven't received my invoice for the last month. Please send it.", "Medium"),
        ("Payment failed", "My credit card was charged but the payment shows as failed on the dashboard. Need this fixed ASAP.", "High"),
        ("Refund request", "I would like to request a refund for order #1234. I canceled it before shipping.", "Medium"),
        ("Overcharged on last bill", "I was charged twice for my subscription this month. Please refund the extra amount.", "High"),
        ("How to update payment method", "Where can I change my credit card details? My old one is expiring soon.", "Low"),
        ("Subscription renewal doubt", "Will my subscription auto-renew next month? I want to stop it.", "Medium"),
        ("Discount code not working", "I tried applying the coupon code SAVE20 but it says invalid.", "Medium"),
        ("Pricing query", "I have a doubt regarding pricing. Can you explain the difference between Pro and Enterprise?", "Low"),
        ("Enterprise billing issue", "Our corporate account is locked due to a billing issue. This is halting our work.", "Critical"),
    ]
    return random.choice(templates)

def gen_technical():
    templates = [
        ("App keeps crashing", "The mobile app crashes every time I try to upload a photo. iPhone 13, iOS 16.", "High"),
        ("Error 500 on checkout", "When I click pay, the screen goes white and says Internal Server Error.", "Critical"),
        ("Sync not working", "My offline changes are not syncing with the cloud version.", "Medium"),
        ("API rate limit exceeded", "We are suddenly hitting API limits even though our traffic hasn't changed.", "High"),
        ("Integration failing", "The Jira integration stopped working after the recent update.", "Medium"),
        ("Slow performance", "The dashboard is taking over 30 seconds to load today. It's usually instant.", "Medium"),
        ("Database connection timeout", "All our users are seeing database timeout errors. Production is down!!", "Critical"),
        ("How do I export data?", "Is there a way to export my data to CSV? I don't see the button.", "Low"),
        ("Bug in reports", "The weekly report shows $0 for all metrics.", "High"),
    ]
    return random.choice(templates)

def gen_account():
    templates = [
        ("Forgot password", "I can't log in and the reset password link is not arriving in my email.", "High"),
        ("Change email address", "How can I change my registered email? I am leaving my company.", "Medium"),
        ("Account locked", "My account says it's locked due to too many failed attempts. Help!", "High"),
        ("MFA not working", "I lost my phone and cannot get past the 2FA screen.", "Critical"),
        ("Add new team member", "I want to invite a new developer to our workspace but I don't have permissions.", "Medium"),
        ("Delete my account", "Please delete my account and all associated data under GDPR.", "Medium"),
        ("Profile picture not updating", "I uploaded a new avatar but it still shows the old one.", "Low"),
        ("Role change request", "Can you upgrade my user role to Admin?", "Low"),
    ]
    return random.choice(templates)

def gen_delivery():
    templates = [
        ("Where is my order?", "Tracking says delivered but I have not received anything.", "High"),
        ("Change shipping address", "I made a mistake in my address. Can I change it before it ships?", "High"),
        ("Damaged item", "The package arrived crushed and the item is broken. I want a replacement.", "Medium"),
        ("Missing parts", "Order #999 arrived but the power cable is missing from the box.", "Medium"),
        ("Late delivery", "I paid for expedited shipping but it has been a week.", "Medium"),
        ("Return label request", "How do I get a return shipping label?", "Low"),
        ("Delivery scheduled on weekend", "Can you deliver on Monday instead? Our office is closed.", "Low"),
    ]
    return random.choice(templates)

def gen_other():
    templates = [
        ("Just chatting", "Nothing much, just chatting to see if this bot works.", "Low"),
        ("Partnership inquiry", "We are an agency looking to partner with you. Who should we contact?", "Low"),
        ("Feedback", "I love the new UI update! Keep up the good work.", "Low"),
        ("Feature request: Dark mode", "Please add a dark mode. My eyes hurt at night.", "Low"),
        ("General question", "What are your business hours?", "Low"),
        ("Unclear request", "It is broken.", "Medium"),
        ("Sales contact", "I want to talk to sales about a custom plan.", "Medium"),
        ("Job application", "Where can I apply for the marketing role?", "Low"),
    ]
    return random.choice(templates)


def generate_ticket(idx, cat_target, pri_target):
    # Depending on the category, pick a template
    if cat_target == "Billing":
        sub, desc, p = gen_billing()
    elif cat_target == "Technical":
        sub, desc, p = gen_technical()
    elif cat_target == "Account":
        sub, desc, p = gen_account()
    elif cat_target == "Delivery":
        sub, desc, p = gen_delivery()
    else:
        sub, desc, p = gen_other()
        
    # We allow the priority to be overridden to balance the dataset
    # but we also keep some natural priorities. We will force the priority to match pri_target
    
    return {
        "subject": sub + (f" [{idx}]" if random.random() > 0.5 else ""),
        "description": desc + f" Ticket reference {idx}.",
        "finalCategory": cat_target,
        "finalPriority": pri_target
    }

tickets = []
count = 0
for cat in CATEGORIES:
    for pri in PRIORITIES:
        # Generate 5 tickets for each combination (5 x 5 x 4 = 100)
        for i in range(5):
            count += 1
            tickets.append(generate_ticket(count, cat, pri))

random.shuffle(tickets)

with open('synthetic_tickets.json', 'w') as f:
    json.dump(tickets, f, indent=2)

print(f"Generated {len(tickets)} synthetic tickets.")
